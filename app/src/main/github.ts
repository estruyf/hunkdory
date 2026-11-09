// Open pull requests through the GitHub CLI. The only network use in Hunkdory, and only for
// projects where you linked the GitHub remote.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { shellEnv, which } from './shellEnv.ts';
import * as g from './git.ts';
import { findRefs } from '../shared/issueRefs.ts';
import type { AgentChoice, BehaviourChange, ChangeDiagram, CheckItem, Dependent, GitHubEvent, GitHubFeedback, GitHubReview, GitHubThread, IssueRef, IssueRefs, PrReview, PullRequest, RequestedItem, TryItStep } from '../shared/types.ts';

const run = promisify(execFile);

/** Private ref namespace: fetched PR heads and bases never touch your branches. */
export const prRef = (n: number) => `refs/reviewer/pr/${n}`;
export const baseRef = (name: string) => `refs/reviewer/base/${name}`;

async function ghBin() {
  const env = await shellEnv();
  const bin = await which('gh', env);
  if (!bin) throw new Error('The GitHub CLI (gh) is not installed. Install it and run "gh auth login".');
  return { bin, env };
}

function ghError(stderr: string): Error {
  const msg = stderr.trim();
  if (/auth login|not logged/i.test(msg)) return new Error('The GitHub CLI is not signed in. Run "gh auth login" in a terminal.');
  return new Error(msg.split('\n')[0] || 'gh failed');
}

async function gh(args: string[], cwd: string): Promise<string> {
  const { bin, env } = await ghBin();
  try {
    const { stdout } = await run(bin, args, { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: 30_000, windowsHide: true });
    return stdout;
  } catch (e) {
    throw ghError(String((e as { stderr?: string }).stderr ?? (e as Error).message));
  }
}

/** A GitHub API call with a JSON body. Errors keep GitHub's HTTP status, so callers can react to a 422. */
async function ghApi(method: string, path: string, cwd: string, body?: unknown): Promise<any> {
  const { bin, env } = await ghBin();
  const args = ['api', '-X', method, path, ...(body === undefined ? [] : ['--input', '-'])];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => (out += b));
    child.stderr.on('data', (b: Buffer) => (err += b));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(out.trim() ? JSON.parse(out) : null);
      const e = ghError(apiErrorText(err, out)) as Error & { status?: number; stdout?: string };
      e.status = Number(err.match(/HTTP (\d{3})/)?.[1] ?? 0) || undefined;
      e.stdout = out;
      reject(e);
    });
    child.stdin.end(body === undefined ? '' : JSON.stringify(body));
  });
}

/**
 * What went wrong in a failed `gh api` call. gh's stderr only has the status ("Unprocessable Entity
 * (HTTP 422)"); GitHub's reason is in the response body on stdout. Pure, so it can be tested.
 */
export function apiErrorText(stderr: string, stdout: string): string {
  try {
    const body = JSON.parse(stdout) as { errors?: unknown[] };
    const reasons = (body?.errors ?? []).map((x) => (typeof x === 'string' ? x : (x as { message?: string })?.message)).filter((x): x is string => !!x?.trim());
    if (reasons.length) return reasons.join('; ');
  } catch {
    // Not JSON: stderr says it best.
  }
  return stderr.trim() || stdout;
}

/** PRs by the GitHub Copilot coding agent. gh reports it as "app/copilot-swe-agent" or "Copilot". */
export const isCopilot = (login: string) => /^(app\/)?copilot(-swe-agent)?(\[bot\])?$/i.test(login);

type Rollup = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string };

/** GitHub's check runs and commit statuses as one list. Pure, so it can be tested. */
export function parseChecks(rollup: Rollup[] | null | undefined): CheckItem[] {
  return (rollup ?? []).map((c) => {
    const result = (c.conclusion || c.state || '').toUpperCase();
    const done = c.__typename === 'StatusContext' ? !['PENDING', 'EXPECTED'].includes(result) : (c.status ?? '').toUpperCase() === 'COMPLETED';
    const state: CheckItem['state'] = !done
      ? 'pending'
      : ['SUCCESS', 'NEUTRAL'].includes(result)
        ? 'pass'
        : ['SKIPPED', 'CANCELLED', 'STALE'].includes(result)
          ? 'skipped'
          : 'fail';
    return { name: c.name || c.context || 'Check', state, url: c.detailsUrl || c.targetUrl || null };
  });
}

/** Is gh installed and signed in? `gh auth token` answers without the network, so being offline doesn't read as signed out. */
export async function ghStatus(): Promise<{ installed: boolean; signedIn: boolean; login: string | null }> {
  const env = await shellEnv();
  const bin = await which('gh', env);
  if (!bin) return { installed: false, signedIn: false, login: null };
  try {
    await run(bin, ['auth', 'token'], { env, timeout: 10_000, windowsHide: true });
  } catch {
    me = null;
    return { installed: true, signedIn: false, login: null };
  }
  const login = await run(bin, ['api', 'user', '--jq', '.login'], { env, timeout: 15_000, windowsHide: true }).then((r) => r.stdout.trim() || null, () => null);
  return { installed: true, signedIn: true, login };
}

/** Is this repo on GitHub, and can gh see it? Returns "owner/name". */
export async function checkRepo(root: string): Promise<string> {
  const out = await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], root);
  return out.trim();
}

const cache = new Map<string, { at: number; prs: PullRequest[] }>();

/** One PR as `gh pr list --json` gives it. */
export interface RawPullRequest {
  number: number;
  title: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  author: { login: string; is_bot?: boolean } | null;
  isDraft: boolean;
  url: string;
  body: string;
  updatedAt: string;
  statusCheckRollup: Rollup[] | null;
  assignees?: { login: string }[] | null;
  // Users and bots by login; a team has its slug (as `slug` or `login`, depending on the gh version) and organization.
  reviewRequests?: { __typename?: string; login?: string; slug?: string; name?: string; organization?: { login?: string } }[] | null;
  latestReviews?: { author: { login: string } | null; state: string }[] | null;
  isCrossRepository?: boolean;
}

const REVIEW_STATES = new Set<string>(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']);

/** Maps gh's JSON onto a PullRequest. Pure, so it can be tested. */
export function toPullRequest(p: RawPullRequest): PullRequest {
  const login = p.author?.login ?? '';
  return {
    number: p.number,
    title: p.title,
    headRefName: p.headRefName,
    headRefOid: p.headRefOid,
    baseRefName: p.baseRefName,
    author: login || 'unknown',
    isBot: !!p.author?.is_bot || /\[bot\]$|^copilot/i.test(login),
    isDraft: p.isDraft,
    url: p.url,
    body: p.body ?? '',
    updatedAt: p.updatedAt,
    copilot: isCopilot(login),
    fork: !!p.isCrossRepository,
    checks: parseChecks(p.statusCheckRollup),
    assignees: (p.assignees ?? []).map((a) => a.login).filter(Boolean),
    requestedReviewers: (p.reviewRequests ?? []).map(reviewerName).filter((x): x is string => !!x),
    // Dismissed and pending reviews say nothing about where the PR stands.
    reviews: (p.latestReviews ?? []).filter((r) => r.author?.login && REVIEW_STATES.has(r.state)).map((r) => ({ login: r.author!.login, state: r.state as PrReview['state'] })),
  };
}

function reviewerName(r: NonNullable<RawPullRequest['reviewRequests']>[number]): string | null {
  if (r.__typename === 'Team') {
    const slug = r.slug ?? r.login ?? r.name;
    if (!slug) return null;
    const org = r.organization?.login;
    return org && !slug.includes('/') ? `${org}/${slug}` : slug;
  }
  return r.login ?? null;
}

export async function openPullRequests(root: string, repo: string, maxAgeMs = 60_000): Promise<PullRequest[]> {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.prs;
  // The people fields cost about 0.3 to 0.5 s on a repo with 35 open PRs (latestReviews brings each review's body along).
  const fields = 'number,title,headRefName,headRefOid,baseRefName,author,isDraft,url,body,updatedAt,isCrossRepository,statusCheckRollup,assignees,reviewRequests,latestReviews';
  const raw = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', fields], root)) as RawPullRequest[];
  const prs = raw.map(toPullRequest);
  cache.set(repo, { at: Date.now(), prs });
  return prs;
}

/** Refspecs for the PR heads and bases we don't have yet. Pure, so it can be tested. */
export function fetchRefspecs(prs: PullRequest[], have: Map<string, string>): string[] {
  const specs: string[] = [];
  for (const p of prs) if (have.get(prRef(p.number)) !== p.headRefOid) specs.push(`+refs/pull/${p.number}/head:${prRef(p.number)}`);
  // Bases move all the time; refresh them whenever we fetch anything.
  if (specs.length) for (const b of new Set(prs.map((p) => p.baseRefName))) specs.push(`+refs/heads/${b}:${baseRef(b)}`);
  return specs;
}

/** The git remote that points at `repo` ("owner/name"), usually origin. */
export async function remoteFor(root: string, repo: string): Promise<string> {
  const out = await g.git(['remote', '-v'], root);
  const line = out.split('\n').find((l) => l.toLowerCase().includes(repo.toLowerCase()));
  return line?.split(/\s/)[0] ?? 'origin';
}

/** Bring PR heads and their bases into refs/reviewer/*, in one fetch. */
export async function fetchPullRequests(root: string, repo: string, prs: PullRequest[]): Promise<void> {
  const have = new Map(
    (await g.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/reviewer/'], root))
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(' ') as [string, string])
  );
  const specs = fetchRefspecs(prs, have);
  if (!specs.length) return;
  const remote = await remoteFor(root, repo);
  try {
    await toGitHub(root, repo, (to) => ['fetch', '--no-tags', '--quiet', to, ...specs]);
  } catch (e) {
    const err = e as { stderr?: string; killed?: boolean; message: string };
    throw fetchError(err.stderr || err.message, remote, !!err.killed);
  }
}

/** git turned away at sign-in: an SSH key GitHub doesn't know, an agent without keys, HTTPS without a credential. Pure, so it can be tested. */
export const signInFailed = (stderr: string) => /Permission denied \(publickey\)|Host key verification failed|Authentication failed|could not read Username|terminal prompts disabled|Invalid username or password/i.test(stderr);

/**
 * Runs a git command that talks to GitHub, through the remote as you set it up. When that can't sign in, it goes
 * again over HTTPS with the GitHub CLI's sign-in, which Hunkdory needs anyway: your git config stays as it is.
 * `args` gets where to talk to: the remote's name, or the HTTPS URL.
 */
async function toGitHub(root: string, repo: string, args: (to: string) => string[]): Promise<void> {
  const env = await shellEnv();
  const opts = { cwd: root, env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000, windowsHide: true };
  try {
    await run('git', args(await remoteFor(root, repo)), opts);
  } catch (e) {
    if (!signInFailed(String((e as { stderr?: string }).stderr ?? ''))) throw e;
    const { bin } = await ghBin();
    // An empty helper first drops the ones from your config, so only gh answers. git runs it with its own sh, which
    // reads a Windows path with `/`.
    const helper = process.platform === 'win32' ? bin.replaceAll('\\', '/') : bin;
    await run('git', ['-c', 'credential.helper=', '-c', `credential.helper=!"${helper}" auth git-credential`, ...args(`https://github.com/${repo}.git`)], opts);
  }
}

/** A failed fetch in a sentence: git's own message is the whole command line, every refspec in it. Pure, so it can be tested. */
export function fetchError(stderr: string, remote: string, timedOut = false): Error {
  const why = (s: string) => new Error(`Couldn't fetch the latest pull requests: ${s}`);
  if (timedOut) return why(`${remote} took longer than 2 minutes to answer.`);
  if (/Host key verification failed/i.test(stderr)) return why(`git doesn't trust GitHub's SSH host key yet. Run "ssh -T git@github.com" in a terminal once.`);
  if (/Permission denied \(publickey\)/i.test(stderr)) return why(`GitHub turned down the SSH key for ${remote}. Check that "ssh -T git@github.com" works in a terminal.`);
  if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(stderr)) return why(`GitHub asked for a sign-in over HTTPS. Run "gh auth setup-git" in a terminal.`);
  if (/Could not resolve host|Network is unreachable|Connection (timed out|refused)|Operation timed out/i.test(stderr)) return why(`GitHub can't be reached. Check your connection.`);
  if (/Repository not found|does not appear to be a git repository/i.test(stderr)) return why(`${remote} points at a repository that doesn't exist or you can't access.`);
  // Otherwise git's own reason, without the command it ran.
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Command failed:') && !l.startsWith('+refs/'));
  const line = lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0];
  return why(line ? line.replace(/^(fatal|error):\s*/, '') : `git fetch from ${remote} failed.`);
}

/** A GraphQL call. GitHub answers a bad query with a 200 and `errors`: those throw too. */
async function graphql(cwd: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await ghApi('POST', 'graphql', cwd, { query, variables });
  const errors = (res?.errors ?? []) as { message?: string }[];
  if (errors.length) throw new Error(errors.map((e) => e.message).filter(Boolean).join('; ') || 'GitHub could not answer');
  return res.data;
}

const FEEDBACK = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(last: 50) { nodes { author { login } state body submittedAt url } }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine diffSide
          comments(first: 50) { nodes { id author { login } body createdAt url } }
        }
      }
    }
  }
}`;

export interface RawFeedback {
  reviews: { nodes: { author: { login: string } | null; state: string; body: string; submittedAt: string | null; url: string }[] };
  reviewThreads: {
    nodes: {
      id: string;
      isResolved: boolean;
      isOutdated: boolean;
      path: string;
      line: number | null;
      startLine: number | null;
      diffSide: 'LEFT' | 'RIGHT';
      comments: { nodes: { id: string; author: { login: string } | null; body: string; createdAt: string; url: string }[] };
    }[];
  };
}

/** GitHub's answer, as Hunkdory shows it. A review with no words of its own only holds line comments: those show as threads. Pure, so it can be tested. */
export function toFeedback(raw: RawFeedback): GitHubFeedback {
  const reviews: GitHubReview[] = raw.reviews.nodes
    .filter((r) => r.state !== 'PENDING' && (r.body.trim() || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'))
    .map((r) => ({ author: r.author?.login ?? 'ghost', state: r.state as GitHubReview['state'], body: r.body, at: r.submittedAt ?? '', url: r.url }));
  const threads: GitHubThread[] = raw.reviewThreads.nodes
    .filter((t) => t.comments.nodes.length)
    .map((t) => ({
      id: t.id,
      path: t.path,
      line: t.isOutdated ? null : t.line,
      startLine: t.isOutdated ? null : t.startLine,
      side: t.diffSide,
      resolved: t.isResolved,
      outdated: t.isOutdated,
      comments: t.comments.nodes.map((c) => ({ id: c.id, author: c.author?.login ?? 'ghost', body: c.body, at: c.createdAt, url: c.url })),
    }));
  return { reviews, threads };
}

const feedbackCache = new Map<string, { at: number; feedback: GitHubFeedback }>();

/** Reviews and review threads on a pull request. Read again after a minute, or right after Hunkdory changed one. */
export async function prFeedback(root: string, repo: string, pr: number, maxAgeMs = 60_000): Promise<GitHubFeedback> {
  const key = `${repo}#${pr}`;
  const hit = feedbackCache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.feedback;
  const [owner, name] = repo.split('/');
  const data = await graphql(root, FEEDBACK, { owner, name, number: pr });
  const feedback = toFeedback(data.repository.pullRequest);
  feedbackCache.set(key, { at: Date.now(), feedback });
  return feedback;
}

/** At most this many are looked up: a list of hundreds in a PR's text shouldn't hold up opening it. */
const MAX_REFS = 30;

export interface RawIssueRef {
  __typename: 'Issue' | 'PullRequest';
  number: number;
  title: string;
  state: string;
  url: string;
  body?: string;
}

/** GitHub's answer per number, as Hunkdory shows it: closing issues first. Pure, so it can be tested. */
export function toIssueRefs(repoUrl: string, wanted: { number: number; closes: boolean }[], answers: Record<string, RawIssueRef | null | undefined>): IssueRefs {
  const refs: IssueRef[] = [];
  const missing: number[] = [];
  for (const { number, closes } of wanted) {
    const a = answers[`n${number}`];
    if (!a) {
      missing.push(number);
      continue;
    }
    refs.push({ number, kind: a.__typename === 'Issue' ? 'issue' : 'pr', title: a.title, state: a.state.toLowerCase() as IssueRef['state'], url: a.url, body: a.body ?? '', closes });
  }
  return { repoUrl, refs: refs.sort((a, b) => Number(b.closes) - Number(a.closes)), missing };
}

const refsCache = new Map<string, { at: number; refs: IssueRefs }>();

/**
 * Looks up what "#123" means in some text. A number GitHub doesn't know fails the whole call, with the other answers
 * still in its output: those count. Read again after a minute. Without an answer, "#123" still links, without a title.
 */
export async function issueReferences(root: string, repo: string, repoUrl: string, texts: (string | null | undefined)[], maxAgeMs = 60_000): Promise<IssueRefs> {
  const wanted = findRefs(texts, repoUrl).slice(0, MAX_REFS);
  const none: IssueRefs = { repoUrl, refs: [], missing: [] };
  if (!wanted.length) return none;
  const key = `${repo}:${JSON.stringify(wanted)}`;
  const hit = refsCache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.refs;
  const [owner, name] = repo.split('/');
  const fields = wanted.map((w) => `n${w.number}: issueOrPullRequest(number: ${w.number}) { __typename ... on Issue { number title state url body } ... on PullRequest { number title state url } }`).join(' ');
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
  let res: { data?: { repository?: Record<string, RawIssueRef | null> | null }; errors?: { type?: string }[] } | null;
  try {
    res = await ghApi('POST', 'graphql', root, { query, variables: { owner, name } });
  } catch (e) {
    try {
      res = JSON.parse((e as { stdout?: string }).stdout ?? '');
    } catch {
      return none;
    }
  }
  // Only "no such number" leaves the rest usable: after anything else, a missing answer says nothing about the number.
  if (!res?.data?.repository || res.errors?.some((e) => e.type !== 'NOT_FOUND')) return none;
  const refs = toIssueRefs(repoUrl, wanted, res.data.repository);
  refsCache.set(key, { at: Date.now(), refs });
  return refs;
}

/** Replies in a review thread, as you. */
export async function replyToThread(root: string, repo: string, pr: number, threadId: string, body: string): Promise<void> {
  await graphql(root, 'mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } } }', { id: threadId, body });
  feedbackCache.delete(`${repo}#${pr}`);
}

/** Resolves a review thread, or opens it again. */
export async function resolveThread(root: string, repo: string, pr: number, threadId: string, resolved: boolean): Promise<void> {
  const op = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  await graphql(root, `mutation($id: ID!) { ${op}(input: { threadId: $id }) { thread { id } } }`, { id: threadId });
  feedbackCache.delete(`${repo}#${pr}`);
}

/** Forget cached pull requests, after Hunkdory changed one. */
export function forget(repo: string) {
  cache.delete(repo);
}

export interface LineComment {
  path: string;
  /** The last line; with `startLine`, a range like "lines +166 to +189". */
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
}

/** A comment in the shape GitHub's review API takes. Pure. */
export const apiComment = ({ startLine, startSide, ...c }: LineComment) => (startLine ? { ...c, start_line: startLine, start_side: startSide ?? c.side } : c);

/**
 * Posts a review. Line comments land on their lines; if GitHub can't place one (the line isn't
 * part of the PR's diff, or the PR moved on), it tries ranges as single lines, then puts them all
 * in the review text instead, with their place.
 */
export async function postReview(root: string, repo: string, pr: number, review: { commitId: string; body: string; event: GitHubEvent; comments: LineComment[] }): Promise<{ url: string | null; inline: boolean }> {
  const path = `repos/${repo}/pulls/${pr}/reviews`;
  const send = (body: string, comments: LineComment[]) => ghApi('POST', path, root, { commit_id: review.commitId, body, event: review.event, comments: comments.map(apiComment) });
  // A range GitHub won't take may still fit as its last line.
  const attempts = [review.comments];
  if (review.comments.some((c) => c.startLine)) attempts.push(review.comments.map(({ startLine: _l, startSide: _s, ...c }) => c));
  for (const comments of attempts) {
    try {
      const res = await send(review.body, comments);
      forget(repo);
      return { url: res?.html_url ?? null, inline: true };
    } catch (e) {
      if ((e as { status?: number }).status !== 422 || !review.comments.length) throw e;
    }
  }
  const res = await send(foldComments(review.body, review.comments), []);
  forget(repo);
  return { url: res?.html_url ?? null, inline: false };
}

/** Line comments as part of the review text. Pure. */
export function foldComments(body: string, comments: LineComment[]): string {
  const lines = comments.map((c) => `**\`${c.path}:${c.line}\`**${c.side === 'LEFT' ? ' (removed line)' : ''}\n${c.body}`);
  return [body, ...lines].filter((x) => x.trim()).join('\n\n');
}

const MARK = '<!-- reviewer:walkthrough -->';
const DATA = /<!-- reviewer:data:([A-Za-z0-9+/=]+) -->/;

/** Text that ends like a sentence, so the next one doesn't run into it. */
const sentence = (s: string) => (/[.!?:]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

const REQUEST_STATUS = { done: 'Code found', partly: 'Partly', missing: 'Not found' } as const;

/** A diagram as a Mermaid chart, which GitHub draws. Labels are quoted, so only a quote or a line break can break out of one. */
function mermaid(d: Pick<ChangeDiagram, 'nodes' | 'edges'>): string[] {
  const quote = (s: string) => `"${s.replace(/\s+/g, ' ').replace(/"/g, '#quot;')}"`;
  const ids = new Map(d.nodes.map((n, i) => [n.id, `n${i}`]));
  return [
    '```mermaid',
    'flowchart TD',
    ...d.nodes.map((n) => `  ${ids.get(n.id)}[${quote(n.unchanged ? `${n.label} (no changes)` : n.label)}]`),
    ...d.edges.map((e) => `  ${ids.get(e.from)} -->${e.label ? `|${quote(e.label)}|` : ''} ${ids.get(e.to)}`),
    '```',
  ];
}

/** A walkthrough as a PR comment people can read, with the data for other Hunkdory users hidden at the end. Pure. */
export function walkthroughComment(
  wt: {
    title?: string;
    intent?: string;
    background?: string | null;
    requested?: { item: string; status: RequestedItem['status']; note: string | null; steps: number[] }[];
    tryIt?: TryItStep[];
    diagram?: ChangeDiagram | null;
    beforeApproving?: string[];
    fromSession?: boolean;
    chapters: { title: string; why?: string; risk?: string; checks?: string[]; outsideTask?: boolean; files?: string[]; choices?: AgentChoice[]; behaviour?: BehaviourChange | null; dependents?: Dependent[] }[];
  },
  data: unknown
): string {
  const n = wt.chapters.length;
  const lines = [MARK, '## Review walkthrough', '', wt.intent ?? '', ''];
  if (wt.background) lines.push(`**To know first:** ${wt.background}`, '');
  if (wt.beforeApproving?.length) lines.push('### Before approving', '', ...wt.beforeApproving.map((l) => `- ${l}`), '');
  if (wt.requested?.length) {
    const steps = (s: number[]) => (s.length ? ` (step${s.length > 1 ? 's' : ''} ${s.join(', ')})` : '');
    lines.push('### What was asked for', '', ...wt.requested.map((r) => `- **${REQUEST_STATUS[r.status]}:** ${r.item}${steps(r.steps)}${r.note ? `. ${sentence(r.note)}` : ''}`), '');
  }
  if (wt.diagram) lines.push('### How it fits together', '', ...(wt.diagram.summary ? [wt.diagram.summary, ''] : []), ...mermaid(wt.diagram), '');
  if (wt.tryIt?.length) lines.push('### How to try it', '', ...wt.tryIt.map((t, i) => `${i + 1}. ${t.do}${t.expect ? ` You should see: ${t.expect}` : ''}`), '');
  lines.push(`<details><summary>${n} step${n === 1 ? '' : 's'}, explained by Hunkdory from the diff${wt.fromSession ? ' and the agent’s session' : ''}</summary>`, '');
  wt.chapters.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.title}${c.outsideTask ? ' (outside the task)' : ''}`, '', c.why ?? '');
    if (c.behaviour) lines.push('', `**Before:** ${c.behaviour.before}`, '', `**Now:** ${c.behaviour.after}`, ...(c.behaviour.example ? ['', `**For example:** ${c.behaviour.example}`] : []));
    if (c.risk) lines.push('', `**Risk:** ${c.risk}`);
    if (c.checks?.length) lines.push('', ...c.checks.map((q) => `- [ ] ${q}`));
    if (c.choices?.length) lines.push('', '**Choices the agent made:**', ...c.choices.map((x) => `- ${[x.question, sentence(x.chose), x.why && sentence(x.why), x.rejected.length && sentence(`Set aside: ${x.rejected.join('; ')}`)].filter(Boolean).join(' ')}`));
    if (c.dependents?.length) lines.push('', '**Unchanged code that relies on this:**', ...c.dependents.map((d) => `- \`${d.path}\`: ${d.what}`));
    if (c.files?.length) lines.push('', `Files: ${c.files.map((f) => `\`${f}\``).join(', ')}`);
    lines.push('');
  });
  lines.push('</details>', '', `<!-- reviewer:data:${Buffer.from(JSON.stringify(data)).toString('base64')} -->`);
  return lines.join('\n');
}

/** The walkthrough data in a comment Hunkdory posted, if it is one. Pure. */
export function readWalkthroughComment(body: string): unknown | null {
  if (!body.includes(MARK)) return null;
  const m = body.match(DATA);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export interface RawIssueComment {
  id: number;
  html_url: string;
  body: string;
  user: { login: string } | null;
  author_association?: string;
}

/** Who has a say in a repo, as GitHub tells it. Anyone else can comment on a public PR, including whoever opened it. */
const TRUSTED_AUTHORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** The newest walkthrough on the PR from you or someone with a say in the repo: a walkthrough is what you read instead of the raw diff, so a stranger doesn't get to write it. Pure. */
export function newestSharedWalkthrough(comments: RawIssueComment[], me: string | null): { id: number; url: string; by: string; data: unknown } | null {
  for (const c of [...comments].reverse()) {
    const by = c.user?.login;
    if (!by || !(TRUSTED_AUTHORS.has(c.author_association ?? '') || by.toLowerCase() === me?.toLowerCase())) continue;
    const data = readWalkthroughComment(c.body ?? '');
    if (data) return { id: c.id, url: c.html_url, by, data };
  }
  return null;
}

/** The newest walkthrough on the PR that Hunkdory can reuse. */
export async function sharedWalkthrough(root: string, repo: string, pr: number): Promise<{ id: number; url: string; by: string; data: unknown } | null> {
  const comments = (await ghApi('GET', `repos/${repo}/issues/${pr}/comments?per_page=100`, root)) as RawIssueComment[];
  return newestSharedWalkthrough(comments, await login(root).catch(() => null));
}

/** Posts the walkthrough, or updates the comment Hunkdory posted before. */
export async function shareWalkthrough(root: string, repo: string, pr: number, body: string, existingId: number | null): Promise<string> {
  const res = existingId
    ? await ghApi('PATCH', `repos/${repo}/issues/comments/${existingId}`, root, { body })
    : await ghApi('POST', `repos/${repo}/issues/${pr}/comments`, root, { body });
  return res.html_url;
}

/** A plain comment on the PR, e.g. to hand work back to Copilot. */
export async function comment(root: string, repo: string, pr: number, body: string): Promise<string> {
  return (await ghApi('POST', `repos/${repo}/issues/${pr}/comments`, root, { body })).html_url;
}

/**
 * The stack a PR is part of: the PRs below it (each one's base is the next one's head) and above it.
 * Bottom first, ending with the branch the bottom PR merges into. Null when it stands alone. Pure.
 */
export function stackOf(prs: PullRequest[], number: number): { base: string; prs: PullRequest[] } | null {
  const byHead = new Map(prs.map((p) => [p.headRefName, p]));
  const self = prs.find((p) => p.number === number);
  if (!self) return null;
  const below: PullRequest[] = [];
  const seen = new Set([self.number]);
  for (let p = byHead.get(self.baseRefName); p && !seen.has(p.number); p = byHead.get(p.baseRefName)) {
    seen.add(p.number);
    below.unshift(p);
  }
  const above: PullRequest[] = [];
  for (let level = [self]; level.length; ) {
    const next = prs.filter((p) => !seen.has(p.number) && level.some((l) => l.headRefName === p.baseRefName));
    for (const p of next) seen.add(p.number);
    above.push(...next.sort((a, b) => a.number - b.number));
    level = next;
  }
  if (!below.length && !above.length) return null;
  return { base: (below[0] ?? self).baseRefName, prs: [...below, self, ...above] };
}

let me: string | null = null;
/** Who gh is signed in as. */
export async function login(root: string): Promise<string> {
  me ??= (await ghApi('GET', 'user', root)).login as string;
  return me;
}

/** Pushes a local branch to the remote for `repo`, and sets it as the branch's upstream. */
export async function pushBranch(root: string, repo: string, branch: string): Promise<void> {
  const remote = await remoteFor(root, repo);
  try {
    await toGitHub(root, repo, (to) => ['push', to, `refs/heads/${branch}:refs/heads/${branch}`]);
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().split('\n').filter(Boolean).slice(-2).join(' ');
    throw new Error(`Couldn't push ${branch}: ${msg}`);
  }
  // The branch follows its copy on GitHub, set by hand: a push over the HTTPS fallback would set a URL as its remote.
  await g.git(['config', `branch.${branch}.remote`, remote], root);
  await g.git(['config', `branch.${branch}.merge`, `refs/heads/${branch}`], root);
}

/** Opens a pull request. Returns its number and URL. */
export async function createPullRequest(root: string, repo: string, pr: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<{ number: number; url: string }> {
  const res = await ghApi('POST', `repos/${repo}/pulls`, root, { head: pr.head, base: pr.base, title: pr.title, body: pr.body, draft: pr.draft });
  forget(repo);
  return { number: res.number, url: res.html_url };
}

/** Merges a pull request with a method the repo allows: a merge commit, else squash, else rebase. */
export async function mergePullRequest(root: string, repo: string, pr: number, sha: string, title: string): Promise<'merge' | 'squash' | 'rebase'> {
  const info = await ghApi('GET', `repos/${repo}`, root);
  const method = info?.allow_merge_commit !== false ? 'merge' : info?.allow_squash_merge !== false ? 'squash' : 'rebase';
  try {
    await ghApi('PUT', `repos/${repo}/pulls/${pr}/merge`, root, { sha, merge_method: method, ...(method === 'rebase' ? {} : { commit_title: `${title} (#${pr})` }) });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 405) throw new Error(`GitHub won't merge PR #${pr} yet. It may need passing checks or another approval, or have conflicts.`);
    if (status === 409) throw new Error(`PR #${pr} changed since you reviewed it. Reload the review and look at what's new first.`);
    throw e;
  }
  forget(repo);
  return method;
}

/** True for GitHub's refusal to let you approve your own pull request. */
export const isOwnPrError = (e: unknown) => /own pull request/i.test(String((e as Error)?.message ?? e));
