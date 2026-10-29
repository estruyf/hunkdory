// Open pull requests through the GitHub CLI. The only network use in Hunkdory, and only for
// projects where you linked the GitHub remote.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { shellEnv, which } from './shellEnv.ts';
import * as g from './git.ts';
import type { CheckItem, GitHubEvent, PrReview, PullRequest } from '../shared/types.ts';

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
    const { stdout } = await run(bin, args, { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
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
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => (out += b));
    child.stderr.on('data', (b: Buffer) => (err += b));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(out.trim() ? JSON.parse(out) : null);
      const e = ghError(err || out) as Error & { status?: number };
      e.status = Number(err.match(/HTTP (\d{3})/)?.[1] ?? 0) || undefined;
      reject(e);
    });
    child.stdin.end(body === undefined ? '' : JSON.stringify(body));
  });
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
  const env = await shellEnv();
  await run('git', ['fetch', '--no-tags', '--quiet', remote, ...specs], { cwd: root, env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
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

/** A walkthrough as a PR comment people can read, with the data for other Hunkdory users hidden at the end. Pure. */
export function walkthroughComment(wt: { title?: string; intent?: string; chapters: { title: string; why?: string; risk?: string; checks?: string[]; outsideTask?: boolean; files?: string[] }[] }, data: unknown): string {
  const n = wt.chapters.length;
  const lines = [MARK, '## Review walkthrough', '', wt.intent ?? '', '', `<details><summary>${n} step${n === 1 ? '' : 's'}, written by Hunkdory from the diff</summary>`, ''];
  wt.chapters.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.title}${c.outsideTask ? ' (outside the task)' : ''}`, '', c.why ?? '');
    if (c.risk) lines.push('', `**Risk:** ${c.risk}`);
    if (c.checks?.length) lines.push('', ...c.checks.map((q) => `- [ ] ${q}`));
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

/** The newest walkthrough a Hunkdory app posted on the PR. */
export async function sharedWalkthrough(root: string, repo: string, pr: number): Promise<{ id: number; url: string; by: string; data: unknown } | null> {
  const comments = (await ghApi('GET', `repos/${repo}/issues/${pr}/comments?per_page=100`, root)) as { id: number; html_url: string; body: string; user: { login: string } }[];
  for (const c of [...comments].reverse()) {
    const data = readWalkthroughComment(c.body ?? '');
    if (data) return { id: c.id, url: c.html_url, by: c.user?.login ?? 'someone', data };
  }
  return null;
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
  const env = await shellEnv();
  try {
    await run('git', ['push', '--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`], { cwd: root, env, timeout: 120_000 });
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().split('\n').filter(Boolean).slice(-2).join(' ');
    throw new Error(`Couldn't push ${branch}: ${msg}`);
  }
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
