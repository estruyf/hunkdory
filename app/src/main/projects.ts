// Projects, their agent branches, and the review data for one branch.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { Worker } from 'node:worker_threads';
import createWtvWorker from './wtv-worker.ts?nodeWorker';
import type { WtvJob, WtvOutput } from './wtv-worker.ts';
import * as g from './git.ts';
import { pathKey } from './paths.ts';
import { belongsTo, readSessions, scanSessionFolders, sessionDirsFor } from './sessions/claude.ts';
import * as gh from './github.ts';
import { buildsOn, duplicateBranches, integrationBranches, matchesPattern, matchSessions, withCheckoutFallback, type BranchSessions } from './match.ts';
import { attention, buildSteps, estimateMinutes } from './steps.ts';
import { projectName, toWatch, withProjectName, type Store } from './store.ts';
import type { GeneratedWalkthroughs } from './writer.ts';
import type { Summaries, Summary } from './summaries.ts';
import { askAbility } from './conversations.ts';
import type { BaseChoice, BranchChoice, BranchInfo, CodeSearchResult, FoundFolder, HunkView, InboxItem, Project, ProjectInput, ProjectScan, PullRequest, RepoCheck, ReviewData, SessionInfo, WalkthroughSource } from '../shared/types.ts';

class WtvRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: WtvOutput) => void; reject: (e: Error) => void }>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = createWtvWorker({});
      this.worker.on('message', (m: { id: number; ok: boolean; value?: WtvOutput; error?: string }) => {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.ok) p?.resolve(m.value!);
        else p?.reject(new Error(m.error));
      });
      this.worker.on('error', (e) => this.failAll(e));
      this.worker.on('exit', () => {
        this.worker = null;
        this.failAll(new Error('wtv worker stopped'));
      });
    }
    return this.worker;
  }

  private failAll(e: Error) {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  run(job: Omit<WtvJob, 'id'>): Promise<WtvOutput> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.w.postMessage({ ...job, id });
    });
  }
}

export const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

export interface Discovered {
  branch: BranchInfo;
  match: BranchSessions | null;
}

export class Projects {
  // Two workers: opening a branch never waits behind an inbox refresh.
  private wtv = new WtvRunner();
  private wtvNow = new WtvRunner();
  // `full` is false for data made for the inbox, without the rows of each hunk.
  private cache = new Map<string, { key: string; data: ReviewData; full: boolean }>();
  private store: Store;
  private generated: GeneratedWalkthroughs;
  private summaries: Summaries;

  constructor(store: Store, generated: GeneratedWalkthroughs, summaries: Summaries) {
    this.store = store;
    this.generated = generated;
    this.summaries = summaries;
  }

  async checkFolder(path: string): Promise<RepoCheck> {
    const full = path.replace(/^~(?=\/|$)/, homedir());
    const empty: RepoCheck = { path: full, isRepo: false, root: null, baseBranch: null, branches: [], remote: null, sessionSources: [], sessionCount: 0 };
    if (!existsSync(full)) return { ...empty, error: 'Folder not found' };
    const root = await g.repoRoot(full);
    if (!root) return { ...empty, error: 'Not a git repository' };
    const [baseBranch, branches, remote, trees] = await Promise.all([g.detectBaseBranch(root), g.localBranches(root), g.remoteUrl(root), g.worktrees(root)]);
    const roots = [root, ...trees.map((t) => t.path)];
    const sessions = readSessions(sessionDirsFor(roots)).filter((s) => belongsTo(s, roots));
    const perDir = new Map<string, number>();
    for (const s of sessions) perDir.set(s.configDir, (perDir.get(s.configDir) ?? 0) + 1);
    return {
      path: full,
      isRepo: true,
      root,
      baseBranch,
      branches,
      remote,
      sessionSources: [...perDir].map(([dir, n]) => ({ dir: tilde(dir), sessions: n })).sort((a, b) => b.sessions - a.sessions),
      sessionCount: sessions.length,
    };
  }

  foundOnThisMac(): FoundFolder[] {
    // Saved paths come from git, session folders from wherever the agent ran: compare them as folders, not strings.
    const known = new Set(this.store.projects().map((p) => pathKey(p.path)));
    const byPath = new Map<string, FoundFolder & { at: number }>();
    for (const f of scanSessionFolders()) {
      // Worktree sessions count towards their repo.
      const path = f.cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '');
      const key = pathKey(path);
      if (known.has(key) || !existsSync(join(path, '.git'))) continue;
      const prev = byPath.get(key);
      byPath.set(key, {
        name: basename(path),
        path: prev?.path ?? path,
        sessions: (prev?.sessions ?? 0) + f.sessions,
        at: Math.max(prev?.at ?? 0, f.lastActive),
        lastActive: new Date(Math.max(prev?.at ?? 0, f.lastActive)).toISOString(),
      });
    }
    return [...byPath.values()].sort((a, b) => b.at - a.at).slice(0, 8).map(({ at: _at, ...f }) => ({ ...f, path: tilde(f.path) }));
  }

  private async validate(root: string, input: Omit<ProjectInput, 'path'>) {
    if (!(await g.refExists(root, input.baseBranch))) throw new Error(`Base branch "${input.baseBranch}" not found`);
    const w = toWatch(input.watch);
    if (w.pattern !== null && !w.pattern.trim()) throw new Error('Enter a branch pattern, like claude/*');
    if (w.pullRequests && !input.github) throw new Error('Link the GitHub remote to review open pull requests.');
    if (!w.anyBranch && w.pattern === null && !w.pullRequests) throw new Error('Pick at least one kind of branch to review.');
  }

  async checkGitHub(path: string): Promise<string> {
    const root = await g.repoRoot(path.replace(/^~(?=\/|$)/, homedir()));
    if (!root) throw new Error('Not a git repository');
    return gh.checkRepo(root);
  }

  async addProject(input: ProjectInput): Promise<Project> {
    // Reviews, ignored and tracked branches hang off the id, so the name is free to change later.
    const check = await this.checkFolder(input.path);
    if (!check.root) throw new Error(check.error ?? 'Not a git repository');
    await this.validate(check.root, input);
    const project: Project = {
      id: randomUUID(),
      name: projectName(input.name, check.root),
      path: check.root,
      baseBranch: input.baseBranch,
      remote: check.remote,
      watch: toWatch(input.watch),
      github: input.github,
      writeWalkthroughs: input.writeWalkthroughs,
      addedAt: new Date().toISOString(),
    };
    this.store.addProject(project);
    return project;
  }

  async updateProject(id: string, input: Omit<ProjectInput, 'path'>): Promise<Project> {
    const project = this.store.project(id);
    await this.validate(project.path, input);
    const updated: Project = { ...withProjectName(project, input.name), baseBranch: input.baseBranch, watch: toWatch(input.watch), github: input.github, writeWalkthroughs: input.writeWalkthroughs ?? project.writeWalkthroughs, remote: await g.remoteUrl(project.path) };
    this.store.addProject(updated);
    // Bases and watch rules change what every review looks like, and the name is on every one.
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}::`)) this.cache.delete(k);
    // A scan that started before this would hand back the old name.
    this.scanning = null;
    return updated;
  }

  setWriteWalkthroughs(id: string, on: boolean) {
    this.store.addProject({ ...this.store.project(id), writeWalkthroughs: on });
    // Every open review carries the answer.
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${id}::`)) this.cache.delete(k);
  }

  /** Every local and remote-tracking branch with commits on top of the base, newest first. */
  async listBranches(projectId: string): Promise<BranchChoice[]> {
    const project = this.store.project(projectId);
    const root = project.path;
    const fmt = ['%(refname)', '%(refname:short)', '%(committerdate:iso-strict)', '%(authorname)', '%(subject)', `%(ahead-behind:${project.baseBranch})`].join('%00');
    const out = await g.git(['for-each-ref', '--sort=-committerdate', `--format=${fmt}`, 'refs/heads', 'refs/remotes'], root);
    const ignored = new Set(project.ignored ?? []);
    const inbox = new Set((await this.discover(project)).items.map((d) => d.branch.name).filter((b) => !ignored.has(b)));
    const base = project.baseBranch.replace(/^[^/]+\//, '');
    const local = new Set<string>();
    const list: BranchChoice[] = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const [full, name, updatedAt, author, subject, ab] = line.split('\0');
      const remote = full.startsWith('refs/remotes/');
      if (full.endsWith('/HEAD') || /(^|\/)gh-readonly-queue\//.test(name)) continue;
      const short = remote ? name.replace(/^[^/]+\//, '') : name;
      if (short === base || ['main', 'master'].includes(short)) continue;
      if (!remote) local.add(name);
      else if (local.has(short)) continue; // the local branch already stands for it
      const ahead = Number(ab?.split(' ')[0] ?? 0);
      if (!ahead) continue;
      // A remote branch whose open PR is already in the inbox counts as in the inbox too.
      list.push({ name, remote, updatedAt, author, subject, ahead, inInbox: inbox.has(name) || inbox.has(short) });
      if (list.length >= 300) break;
    }
    return list;
  }

  /** Branches the review could compare against: each with the branch's commits that aren't on it, fewest first. */
  async listBases(projectId: string, branch: string): Promise<BaseChoice[]> {
    const { project, d } = await this.find(projectId, branch);
    const fmt = ['%(refname)', '%(refname:short)', `%(ahead-behind:${d.branch.headSha})`].join('%00');
    const out = await g.git(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'], project.path);
    const short = branch.replace(/^[^/]+\//, '');
    const list: BaseChoice[] = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const [full, name, ab] = line.split('\0');
      if (full.endsWith('/HEAD') || /(^|\/)gh-readonly-queue\//.test(name)) continue;
      if (name === branch || name.replace(/^[^/]+\//, '') === short) continue;
      // `behind` is what the branch has that this ref doesn't: the commits a review against it shows.
      const commits = Number(ab?.split(' ')[1] ?? 0);
      if (commits) list.push({ name, commits });
    }
    return list.sort((a, b) => a.commits - b.commits).slice(0, 300);
  }

  /** Compares one branch against `base`, whatever the project's base. `null` goes back to Hunkdory's pick. */
  async setBase(projectId: string, branch: string, base: string | null) {
    const before = this.store.project(projectId);
    if (base && !(await g.refExists(before.path, base))) throw new Error(`Branch ${base} not found`);
    const save = (bases: Record<string, string>) => {
      this.store.addProject({ ...this.store.project(projectId), bases });
      // A scan that started before this would hand back the old size.
      this.scanning = null;
    };
    const { [branch]: _old, ...rest } = before.bases ?? {};
    save(base ? { ...rest, [branch]: base } : rest);
    try {
      await this.find(projectId, branch);
    } catch {
      save(before.bases ?? {});
      throw new Error(`${branch} has no changes on top of ${base ?? 'the base Hunkdory picks'}.`);
    }
  }

  ignoreBranch(projectId: string, branch: string, on: boolean) {
    const project = this.store.project(projectId);
    const rest = (project.ignored ?? []).filter((b) => b !== branch);
    this.store.addProject({ ...project, ignored: on ? [...rest, branch] : rest });
    // A scan that started before this would hand back the old list.
    this.scanning = null;
  }

  async trackBranch(projectId: string, branch: string): Promise<void> {
    // Picking a branch you ignored brings it back.
    const short = branch.replace(/^[^/]+\//, '');
    const before = this.store.project(projectId);
    if (before.ignored?.some((b) => b === branch || b === short)) this.store.addProject({ ...before, ignored: before.ignored.filter((b) => b !== branch && b !== short) });
    const project = this.store.project(projectId);
    // Watching every pull request, an open PR is in the inbox already, by its head branch name.
    if (project.watch.pullRequests && project.github) {
      const prs = await gh.openPullRequests(project.path, project.github).catch(() => [] as PullRequest[]);
      if (prs.some((p) => p.headRefName === branch)) return this.store.reopenReview(projectId, branch);
    }
    if (!(await g.refExists(project.path, branch))) throw new Error(`Branch ${branch} not found`);
    this.store.addProject({ ...project, tracked: [...new Set([...(project.tracked ?? []), branch])] });
    // Picking a branch you finished before starts a new round.
    this.store.reopenReview(projectId, branch);
  }

  /** What needs a review in a project, plus counts that explain an empty inbox. */
  /** `only` narrows the work to one branch, for opening a review without scanning the whole project. */
  async discover(project: Project, only?: string): Promise<{ items: Discovered[]; scan: ProjectScan }> {
    const root = project.path;
    const [trees, branches] = await Promise.all([g.worktrees(root), g.localBranches(root)]);
    const roots = [root, ...trees.map((t) => t.path)];
    const found = readSessions(sessionDirsFor(roots)).filter((s) => belongsTo(s, roots));
    const exclude = integrationBranches(found, project.baseBranch);
    const sessions = withCheckoutFallback(found, trees, exclude);
    const exists = new Set(branches);
    const scan: ProjectScan = { projectId: project.id, sessions: found.length, branchesSeen: 0, gone: 0, upToDate: 0, waiting: 0, pullRequests: null };

    // Every branch a session touched, whether it still exists or not, for the scan.
    const seen = new Set(sessions.flatMap((s) => s.branches.map((b) => b.name)).filter((b) => !exclude.has(b)));
    scan.branchesSeen = seen.size;
    scan.gone = [...seen].filter((b) => !exists.has(b)).length;

    // Pull requests first: a branch that is also an open PR shows up once, as the PR.
    // The Copilot coding agent works on GitHub, not on this Mac: its open PRs are agent work even when you don't watch every PR.
    const prs = !project.github
      ? []
      : project.watch.pullRequests
        ? await this.discoverPullRequests(project, sessions, exclude, scan, only)
        : await this.discoverPullRequests(project, sessions, exclude, scan, only, (p) => p.copilot);
    const skip = new Set(prs.map((d) => d.branch.name));
    let items = [...prs, ...(await this.discoverBranches(project, sessions, branches, trees, exclude, scan, { skip, only }))];
    if (!only) items = foldDuplicates(items);
    scan.waiting = items.length;
    return { items, scan };
  }

  private async discoverBranches(
    project: Project,
    sessions: SessionInfo[],
    branches: string[],
    trees: g.Worktree[],
    exclude: Set<string>,
    scan: ProjectScan,
    opts: { skip?: Set<string>; only?: string } = {}
  ): Promise<Discovered[]> {
    const root = project.path;
    const exists = new Set(branches);
    // Look up sessions by branch name even when only the remote branch is left.
    const matched = matchSessions(sessions, { exists: () => true, exclude });
    // Agent or person, any branch counts; a session on it adds the prompt and reasoning.
    const pattern = project.watch.pattern;
    const watched = (b: string) => project.watch.anyBranch || (!!pattern && matchesPattern(b, pattern));
    const names = new Set(branches.filter((b) => !exclude.has(b) && !opts.skip?.has(b) && watched(b)));
    const tracked = new Set<string>();
    // A picked remote branch ("origin/x") that is also an open PR's head ("x") shows up once, as the PR.
    const skipped = (b: string) => !!opts.skip && (opts.skip.has(b) || opts.skip.has(b.replace(/^[^/]+\//, '')));
    for (const b of project.tracked ?? []) if (!skipped(b) && (await g.refExists(root, b))) tracked.add(b);
    for (const b of tracked) names.add(b);
    const prs = project.github ? await gh.openPullRequests(root, project.github).catch(() => [] as PullRequest[]) : [];

    const out: Discovered[] = [];
    for (const name of names) {
      if (opts.only && name !== opts.only) continue;
      const tree = trees.find((t) => t.branch === name);
      const checkout: BranchInfo['checkout'] = tree ? { kind: tree.path === root ? 'main' : 'worktree', path: tree.path } : { kind: 'none' };
      const local = exists.has(name) ? name : name.replace(/^[^/]+\//, '');
      const match = matched.get(name) ?? matched.get(local) ?? null;
      const pr = prs.find((p) => p.headRefName === local) ?? null;
      // A base you picked wins. Then an open pull request, which says what the branch merges into: that beats guessing, and matters for stacked PRs.
      const chosen = await chosenBase(project, name);
      const prBase = pr && !chosen ? await firstRef(root, [gh.baseRef(pr.baseRefName), `origin/${pr.baseRefName}`, pr.baseRefName]) : null;
      const { ref: baseRef, ahead } = await this.pickBase(root, name, chosen ? [chosen] : prBase ? [prBase] : [match?.origin.originalBranch, project.baseBranch, ...exclude]);
      const headSha = (await g.git(['rev-parse', name], root)).trim();
      const dirty = checkout.kind === 'none' ? 0 : (await g.dirtyFiles(checkout.path)).length;
      if (!ahead && !dirty) {
        scan.upToDate++;
        continue;
      }
      out.push({
        branch: {
          projectId: project.id,
          name,
          checkout,
          baseRef,
          baseName: prBase ? pr!.baseRefName : baseRef,
          baseChosen: !!chosen,
          headRef: name,
          headSha,
          pr,
          tracked: tracked.has(name),
          dirtyFiles: dirty,
          sessionIds: match?.sessions.map((s) => s.id) ?? [],
        },
        match,
      });
    }
    return out;
  }

  /** Every open pull request, fetched into refs/reviewer/*. A local session on the PR's branch adds the prompt and send back. */
  private async discoverPullRequests(project: Project, sessions: SessionInfo[], exclude: Set<string>, scan: ProjectScan, only?: string, filter?: (p: PullRequest) => boolean): Promise<Discovered[]> {
    const root = project.path;
    let prs: PullRequest[];
    try {
      prs = (await gh.openPullRequests(root, project.github!)).filter((p) => !filter || filter(p));
      await gh.fetchPullRequests(root, project.github!, only ? prs.filter((p) => p.headRefName === only) : prs);
    } catch (e) {
      scan.error = (e as Error).message;
      return [];
    }
    if (!filter) scan.pullRequests = prs.length;
    const matched = matchSessions(sessions, { exists: () => true, exclude });
    const out: Discovered[] = [];
    for (const pr of prs) {
      if (only && pr.headRefName !== only) continue;
      const headRef = gh.prRef(pr.number);
      const chosen = await chosenBase(project, pr.headRefName);
      const baseRef = chosen ?? gh.baseRef(pr.baseRefName);
      if (!(await g.refExists(root, headRef)) || !(await g.refExists(root, baseRef))) continue;
      const match = matched.get(pr.headRefName) ?? null;
      out.push({
        branch: {
          projectId: project.id,
          name: pr.headRefName,
          checkout: { kind: 'none' },
          baseRef,
          baseName: chosen ?? pr.baseRefName,
          baseChosen: !!chosen,
          headRef,
          headSha: pr.headRefOid,
          pr,
          tracked: false,
          dirtyFiles: 0,
          sessionIds: match?.sessions.map((s) => s.id) ?? [],
        },
        match,
      });
    }
    return out;
  }

  /**
   * The integration branch this branch was cut from: the candidate it has the fewest
   * commits on top of. Ties go to the earlier candidate (session origin, then project base).
   */
  private async pickBase(root: string, branch: string, candidates: (string | null | undefined)[]): Promise<{ ref: string; ahead: number }> {
    let best: { ref: string; ahead: number } | null = null;
    for (const ref of new Set(candidates.filter((c): c is string => !!c && c !== branch))) {
      const n = (await g.tryGit(['rev-list', '--count', `${ref}..${branch}`], root))?.trim();
      if (n === undefined || n === '') continue;
      if (!best || Number(n) < best.ahead) best = { ref, ahead: Number(n) };
    }
    return best ?? { ref: candidates.find(Boolean)!, ahead: 0 };
  }

  /** The branch's own walkthrough wins. Without one, the walkthrough Hunkdory wrote, if any. */
  private async readWalkthrough(d: Discovered, root: string, baseSha: string): Promise<{ value: unknown | null; text: string; source: Exclude<WalkthroughSource, 'skeleton'>; error?: string }> {
    let text: string | null = null;
    if (d.branch.checkout.kind !== 'none') {
      const file = join(d.branch.checkout.path, '.review', 'walkthrough.json');
      if (existsSync(file)) text = readFileSync(file, 'utf8');
    } else {
      text = await g.tryGit(['show', `${d.branch.headRef}:.review/walkthrough.json`], root);
    }
    const source = text ? 'agent' : 'reviewer';
    if (!text) {
      // Hunkdory's own walkthrough only counts for the base it was written against: a new base is a different diff.
      const mine = this.generated.read(d.branch.projectId, d.branch.name);
      try {
        if (mine && JSON.parse(mine).base === baseSha) text = mine;
      } catch {}
    }
    if (!text) return { value: null, text: '', source };
    try {
      const value = JSON.parse(text);
      if (!Array.isArray(value?.chapters)) return { value: null, text, source, error: 'The walkthrough has no "chapters" list, so Hunkdory split the change by file.' };
      return { value, text, source };
    } catch (e) {
      return { value: null, text, source, error: `The walkthrough isn't valid JSON (${(e as Error).message}), so Hunkdory split the change by file.` };
    }
  }

  /** Changes when anything that affects the review changes: commits, uncommitted edits, the walkthrough. */
  private async fingerprint(d: Discovered, baseSha: string, walkthrough: string): Promise<string> {
    const h = createHash('sha1').update(`${d.branch.headSha}\0${baseSha}\0${walkthrough}`);
    if (d.branch.checkout.kind !== 'none') {
      const path = d.branch.checkout.path;
      for (const f of await g.dirtyFiles(path)) {
        try {
          const st = statSync(join(path, f));
          h.update(`\0${f}:${st.mtimeMs}:${st.size}`);
        } catch {
          h.update(`\0${f}:gone`);
        }
      }
    }
    return h.digest('hex');
  }

  async find(projectId: string, branch: string): Promise<{ project: Project; d: Discovered }> {
    const project = this.store.project(projectId);
    const d = (await this.discover(project, branch)).items.find((x) => x.branch.name === branch);
    if (!d) throw new Error(`Branch ${branch} has nothing left to review. It may have been merged or deleted.`);
    return { project, d };
  }

  async review(projectId: string, branch: string, refresh = false): Promise<ReviewData> {
    const { project, d } = await this.find(projectId, branch);
    return this.reviewFor(project, d, { refresh, runner: this.wtvNow });
  }

  /** Where a branch's changes are: its checkout (with uncommitted work) or, when it has none, its ref in the repo. */
  private async locate(project: Project, d: Discovered) {
    const root = project.path;
    const baseSha = (await g.git(['merge-base', d.branch.baseRef, d.branch.headRef], root)).trim();
    const inTree = d.branch.checkout.kind !== 'none';
    return { root, baseSha, inTree, headRef: d.branch.headRef, cwd: inTree ? (d.branch.checkout as { path: string }).path : root };
  }

  async runContext(projectId: string, branch: string) {
    const { project, d } = await this.find(projectId, branch);
    return this.locate(project, d);
  }

  /** The PR stack this branch is in, with the branch name Hunkdory opens each PR's review by. */
  private async stack(project: Project, d: Discovered): Promise<ReviewData['stack']> {
    const pr = d.branch.pr;
    if (!pr || !project.github) return null;
    const prs = await gh.openPullRequests(project.path, project.github).catch(() => [] as PullRequest[]);
    const st = gh.stackOf(prs, pr.number);
    if (!st) return null;
    const entries = [];
    for (const p of st.prs) {
      const branch =
        p.number === pr.number
          ? d.branch.name
          : project.watch.pullRequests ||(await g.refExists(project.path, `refs/heads/${p.headRefName}`))
            ? p.headRefName
            : `origin/${p.headRefName}`;
      entries.push({ number: p.number, title: p.title, branch, url: p.url, current: p.number === pr.number, status: this.store.review(project.id, branch)?.status ?? null });
    }
    return { base: st.base, prs: entries };
  }

  /** Part of a file on one side of the diff: the base, or the branch as Hunkdory shows it (checkout or ref). */
  async fileLines(projectId: string, branch: string, path: string, side: 'old' | 'new', from: number, to: number): Promise<{ lines: string[]; total: number }> {
    const { project, d } = await this.find(projectId, branch);
    const at = await this.locate(project, d);
    let text: string | null = null;
    if (side === 'old') text = await g.tryGit(['show', `${at.baseSha}:${path}`], at.root);
    else if (!at.inTree) text = await g.tryGit(['show', `${at.headRef}:${path}`], at.root);
    else {
      const full = resolve(at.cwd, path);
      // Only files inside the checkout: the path comes from the window.
      if (!full.startsWith(at.cwd + sep)) throw new Error('That file is outside the branch.');
      try {
        text = readFileSync(full, 'utf8');
      } catch {}
    }
    if (text === null) return { lines: [], total: 0 };
    const all = text.split('\n');
    if (all.at(-1) === '') all.pop();
    return { lines: all.slice(Math.max(0, from - 1), Math.max(0, to)), total: all.length };
  }

  /**
   * Every place some text appears in the branch as Hunkdory shows it: the whole repo, not only the diff.
   * Plain text, not a pattern. All lower case matches any case.
   */
  async searchCode(projectId: string, branch: string, query: string): Promise<CodeSearchResult> {
    const q = query.trim();
    if (q.length < 2) return { matches: [], truncated: false };
    const { project, d } = await this.find(projectId, branch);
    const at = await this.locate(project, d);
    const args = ['grep', '-n', '-z', '-I', '--fixed-strings', '--max-count=20', ...(q === q.toLowerCase() ? ['-i'] : [])];
    // A checkout includes uncommitted and new files; otherwise the branch's commit.
    if (at.inTree) args.push('--untracked', '-e', q, '--');
    else args.push('-e', q, at.headRef, '--');
    args.push('.', ':(exclude).review');
    // Exit code 1 means no matches.
    const out = (await g.tryGit(args, at.cwd)) ?? '';
    const prefix = at.inTree ? '' : `${at.headRef}:`;
    const matches: CodeSearchResult['matches'] = [];
    let truncated = false;
    for (const row of out.split('\n')) {
      const [file, line, ...rest] = row.split('\0');
      if (!file || !line) continue;
      if (matches.length >= 300) {
        truncated = true;
        break;
      }
      const text = rest.join('\0');
      matches.push({ path: file.startsWith(prefix) ? file.slice(prefix.length) : file, line: Number(line), text: text.length > 400 ? `${text.slice(0, 400)}…` : text });
    }
    return { matches, truncated };
  }

  /** The open PR for a branch, when GitHub is linked: for posting a review or sharing a walkthrough. */
  async pullRequest(projectId: string, branch: string): Promise<{ project: Project; d: Discovered; pr: PullRequest; repo: string }> {
    const { project, d } = await this.find(projectId, branch);
    if (!project.github) throw new Error('Link the GitHub remote in the project settings first.');
    if (!d.branch.pr) throw new Error(`${branch} has no open pull request.`);
    return { project, d, pr: d.branch.pr, repo: project.github };
  }

  /** Verifies a walkthrough against the branch without keeping it. */
  async check(projectId: string, branch: string, walkthrough: unknown): Promise<WtvResult> {
    const { project, d } = await this.find(projectId, branch);
    const at = await this.locate(project, d);
    const out = await this.wtvNow.run({ cwd: at.cwd, baseSha: at.baseSha, head: at.inTree ? null : at.headRef, walkthrough });
    return out.result;
  }

  /** Where the branch's changes are, its walkthrough, and a fingerprint of both. */
  private async prepare(project: Project, d: Discovered) {
    const at = await this.locate(project, d);
    const wt = await this.readWalkthrough(d, at.root, at.baseSha);
    return { at, wt, key: await this.fingerprint(d, at.baseSha, wt.text) };
  }

  /** `lines: false` leaves out the rows of each hunk, which is most of the work and only the review screen shows. */
  private async reviewFor(
    project: Project,
    d: Discovered,
    opts: { refresh?: boolean; runner?: WtvRunner; lines?: boolean; prepared?: Awaited<ReturnType<Projects['prepare']>> } = {}
  ): Promise<ReviewData> {
    const { refresh = false, runner = this.wtv, lines = true } = opts;
    const { at, wt, key } = opts.prepared ?? (await this.prepare(project, d));
    const { root, baseSha, inTree, cwd } = at;
    const cacheId = `${project.id}::${d.branch.name}`;
    const hit = this.cache.get(cacheId);
    if (!refresh && hit?.key === key && (hit.full || !lines)) return hit.data;

    const out = await runner.run({ cwd, baseSha, head: inTree ? null : d.branch.headRef, walkthrough: wt.value, lines });
    const r = out.result;
    const source: WalkthroughSource = out.source === 'skeleton' ? 'skeleton' : wt.source;
    const steps = buildSteps(r, source);
    const flags = attention(r, steps, source);
    if (wt.error) flags.unshift({ severity: 'medium', title: 'Walkthrough unreadable', detail: wt.error, stepKey: null });

    const notes = new Map<string, string[]>();
    for (const ch of r.chapters) for (const n of ch.notes ?? []) for (const id of n.hunkIds) notes.set(id, [...(notes.get(id) ?? []), n.text]);

    const hunks: Record<string, HunkView> = {};
    for (const h of r.hunks) {
      hunks[h.id] = {
        id: h.id,
        path: h.path,
        oldPath: h.oldPath,
        status: h.status,
        untracked: h.untracked,
        synthetic: h.synthetic,
        bucket: h.bucket,
        level: h.level,
        risks: h.risks,
        added: h.added.length,
        removed: h.removed.length,
        rangeLabel: out.ranges[h.id] ?? '',
        lines: out.lines[h.id] ?? [],
        note: notes.get(h.id)?.join(' ') ?? null,
      };
    }

    const session = d.match?.sessions[0] ?? null;
    const prompt = d.match?.origin.firstPrompt ?? null;
    const intent = r.intent && !/^todo\b/i.test(r.intent.trim()) ? r.intent : null;
    const firstLine = prompt?.split('\n').find((l) => l.trim())?.trim();
    const [author, subject] = (await g.tryGit(['log', '-1', '--format=%an%x00%s', d.branch.headRef], root))?.trim().split('\0') ?? [];
    const promptTitle = firstLine && firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
    const wtTitle = (wt.value as { title?: unknown } | null)?.title;
    const shortTitle = typeof wtTitle === 'string' && wtTitle.trim() ? wtTitle.trim() : null;
    // A title the author gave wins. Hunkdory's own comes after the PR, session and commit-free fallbacks;
    // its one-sentence intent is too long for a title, so that's a last resort.
    const authorTitle = source === 'agent' ? (shortTitle ?? intent) : null;
    const reviewerTitle = source === 'reviewer' ? shortTitle : null;
    const title = authorTitle ?? d.branch.pr?.title ?? d.match?.origin.title ?? promptTitle ?? reviewerTitle ?? subject ?? intent ?? d.branch.name;

    const shared = (wt.value as { shared?: { url: string; by: string } } | null)?.shared;
    const data: ReviewData = {
      ask: askAbility(session, d.branch),
      agent: d.match ? 'claude-code' : d.branch.pr?.copilot ? 'copilot' : null,
      headSha: d.branch.headSha,
      dirty: d.branch.dirtyFiles > 0,
      stack: await this.stack(project, d),
      sharedWalkthrough: source === 'reviewer' && shared ? shared : null,
      repo: project.github,
      projectId: project.id,
      projectName: project.name,
      agentTests: d.match
        ? {
            runs: d.match.sessions.flatMap((s) => s.testRuns ?? []).sort((a, b) => a.at.localeCompare(b.at)),
            lastEditAt: d.match.sessions.map((s) => s.lastEditAt).filter((t): t is string => !!t).sort().at(-1) ?? null,
          }
        : null,
      writeWalkthroughs: project.writeWalkthroughs ?? null,
      branch: d.branch.name,
      baseRef: d.branch.baseName,
      baseChosen: d.branch.baseChosen,
      baseSha,
      head: r.head,
      pr: d.branch.pr,
      prByYou: !!d.branch.pr && d.branch.pr.author === (await gh.login(root).catch(() => null)),
      local: !d.branch.pr && d.branch.headRef === d.branch.name && (await g.refExists(root, `refs/heads/${d.branch.name}`)),
      author: d.match ? null : author || null,
      walkthrough: source,
      intent,
      title,
      prompt,
      session,
      sessionCount: d.match?.sessions.length ?? 0,
      files: r.files,
      added: r.hunks.reduce((n, h) => n + h.added.length, 0),
      removed: r.hunks.reduce((n, h) => n + h.removed.length, 0),
      steps,
      hunks,
      attention: flags,
      ok: r.ok,
      minutes: estimateMinutes(steps, r.hunks),
    };
    this.cache.set(cacheId, { key, data, full: lines });
    return data;
  }

  private scanning: Promise<{ items: InboxItem[]; scans: ProjectScan[]; me: string | null }> | null = null;

  /** Two screens asking at once share one scan. */
  inbox(refresh = false): Promise<{ items: InboxItem[]; scans: ProjectScan[]; me: string | null }> {
    if (this.scanning && !refresh) return this.scanning;
    const run = this.scanInbox(refresh).finally(() => {
      if (this.scanning === run) this.scanning = null;
    });
    this.scanning = run;
    return run;
  }

  private async scanInbox(refresh: boolean): Promise<{ items: InboxItem[]; scans: ProjectScan[]; me: string | null }> {
    const listed = new Set<string>();
    // Who "you" are on GitHub, for the People filter. Asked once per run, alongside the scan.
    const linked = this.store.projects().find((p) => p.github);
    const me = linked ? gh.login(linked.path).catch(() => null) : Promise.resolve(null);
    // Projects are read side by side: most of the time goes to waiting on git and gh.
    const per = await Promise.all(this.store.projects().map((p) => this.projectInbox(p, refresh, listed, me)));
    this.summaries.keepOnly(listed);
    const items = per.flatMap((r) => r.items);
    items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return { items, scans: per.map((r) => r.scan), me: await me };
  }

  private async projectInbox(project: Project, refresh: boolean, listed: Set<string>, me: Promise<string | null>): Promise<{ items: InboxItem[]; scan: ProjectScan }> {
    let found: Discovered[];
    let scan: ProjectScan;
    // You, as this repo's commits know you: local branches are matched on email first, then name.
    const gitUser = Promise.all([g.tryGit(['config', 'user.email'], project.path), g.tryGit(['config', 'user.name'], project.path)]).then(([email, name]) => ({ email: email?.trim().toLowerCase() || null, name: name?.trim() || null }));
    try {
      ({ items: found, scan } = await this.discover(project));
    } catch (e) {
      return { items: [], scan: { projectId: project.id, sessions: 0, branchesSeen: 0, gone: 0, upToDate: 0, waiting: 0, pullRequests: null, error: (e as Error).message } };
    }
    // Review fixes on top of a PR and the like: their diff holds the other branch's changes too.
    const unique = new Map(
      await Promise.all(found.map(async (d) => [d.branch.name, new Set((await g.tryGit(['rev-list', '--max-count=500', `${d.branch.baseRef}..${d.branch.headRef}`], project.path))?.split('\n').filter(Boolean) ?? [])] as const))
    );
    const under = buildsOn(found.map((d) => ({ name: d.branch.name, headSha: d.branch.headSha })), unique);
    const ignored = new Set(project.ignored ?? []);
    const items = await Promise.all(
      found.map(async (d): Promise<InboxItem | null> => {
        const state = this.store.review(project.id, d.branch.name);
        if (state?.status === 'discarded' || state?.status === 'merged') return null;
        // After you reviewed or sent it back, it only needs you again once it changed.
        const decidedOn = state?.decision?.headSha;
        const updatedSinceReview = !!decidedOn && decidedOn !== d.branch.headSha;
        if (state?.status === 'reviewed' && !updatedSinceReview) return null;
        const pr = d.branch.pr;
        const who = d.match ? `Claude Code${d.match.sessions.length > 1 ? ` · ${d.match.sessions.length} sessions` : ''}` : pr?.copilot ? 'GitHub Copilot' : pr ? `by ${pr.author}` : 'No agent session';
        const id = `${project.id}::${d.branch.name}`;
        listed.add(id);
        // A local branch is "opened" by whoever made its newest commit; one git call also gives its date.
        const [authorName, authorEmail, committed] = pr ? [] : ((await g.tryGit(['log', '-1', '--format=%an%x00%ae%x00%cI', d.branch.headRef], project.path))?.trim().split('\0') ?? []);
        const you = await gitUser;
        const prAuthor = pr && pr.author !== 'unknown' ? pr.author : null;
        const openedBy = pr ? prAuthor : authorName || null;
        const openedByYou = pr ? !!prAuthor && prAuthor === (await me) : (!!you.email && authorEmail?.toLowerCase() === you.email) || (!!you.name && authorName === you.name);
        const base: InboxItem = {
          projectId: project.id,
          projectName: project.name,
          branch: d.branch.name,
          title: pr?.title ?? d.match?.origin.title ?? d.branch.name,
          agent: pr ? `${who} · PR #${pr.number}` : who,
          files: 0,
          added: 0,
          removed: 0,
          steps: 0,
          minutes: 0,
          flags: [],
          updatedAt: pr?.updatedAt ?? d.match?.lastSeen ?? (committed || null),
          walkthrough: 'skeleton',
          pr: pr ? { number: pr.number, isDraft: pr.isDraft, url: pr.url, author: prAuthor, assignees: pr.assignees, requestedReviewers: pr.requestedReviewers, reviews: pr.reviews } : null,
          openedBy,
          openedByYou,
          checks: pr?.checks ?? [],
          updatedSinceReview,
          buildsOn: (() => {
            const o = found.find((x) => x.branch.name === under.get(d.branch.name));
            return o ? { branch: o.branch.name, pr: o.branch.pr?.number ?? null } : null;
          })(),
          tracked: !!d.branch.tracked,
          review: state ? { status: state.status, reviewedSteps: Object.keys(state.reviewed).length } : null,
          ignored: ignored.has(d.branch.name),
        };
        // An ignored branch only needs a name in the list: skip the diff.
        if (base.ignored) return base;
        try {
          const prepared = await this.prepare(project, d);
          // The title can come from the PR or the session, which change without a commit.
          const key = `${prepared.key}:${createHash('sha1').update(JSON.stringify([pr?.title, d.match?.origin.title, d.match?.origin.firstPrompt])).digest('hex')}`;
          let sum = refresh ? null : this.summaries.get(id, key);
          if (!sum) {
            sum = summarize(await this.reviewFor(project, d, { refresh, lines: false, prepared }));
            this.summaries.set(id, key, sum);
          }
          return { ...base, ...sum, title: base.title === d.branch.name ? sum.title : base.title, agent: sum.author && !d.match && !pr ? `by ${sum.author}` : base.agent };
        } catch (e) {
          return { ...base, error: (e as Error).message };
        }
      })
    );
    return { items: items.filter((x): x is InboxItem => !!x), scan };
  }
}

/** Folds branches on the same commit as another one into it, sessions and all. */
function foldDuplicates(items: Discovered[]): Discovered[] {
  const dups = duplicateBranches(items.map((d) => ({ name: d.branch.name, headSha: d.branch.headSha, pr: !!d.branch.pr, dirty: d.branch.dirtyFiles > 0 })));
  for (const [name, into] of dups) {
    const dup = items.find((d) => d.branch.name === name)!;
    const keep = items.find((d) => d.branch.name === into)!;
    keep.branch.sessionIds = [...new Set([...keep.branch.sessionIds, ...dup.branch.sessionIds])];
    // The kept branch's own sessions stay first: they made it, and send back resumes the first.
    const extra = (dup.match?.sessions ?? []).filter((s) => !keep.match?.sessions.some((k) => k.id === s.id));
    keep.match = keep.match ? { ...keep.match, sessions: [...keep.match.sessions, ...extra] } : dup.match;
  }
  return items.filter((d) => !dups.has(d.branch.name));
}

/** The base you picked for a branch, while it still exists. */
async function chosenBase(project: Project, branch: string): Promise<string | null> {
  const base = project.bases?.[branch];
  return base && (await g.refExists(project.path, base)) ? base : null;
}

async function firstRef(root: string, refs: string[]): Promise<string | null> {
  for (const ref of refs) if (await g.refExists(root, ref)) return ref;
  return null;
}

function summarize(data: ReviewData): Summary {
  const outside = data.steps.filter((s) => s.outsideTask).length;
  const deps = new Set(Object.values(data.hunks).filter((h) => h.risks.some((r) => r.code === 'deps')).map((h) => h.path)).size;
  const high = data.steps.filter((s) => s.risk === 'high').length;
  const flags = [];
  if (outside) flags.push(`${outside} change${outside > 1 ? 's' : ''} outside your request`);
  if (deps) flags.push(`${deps === 1 ? 'Dependency' : `${deps} dependency`} change${deps > 1 ? 's' : ''}`);
  if (high) flags.push(`${high} step${high > 1 ? 's need' : ' needs'} attention`);
  return {
    title: data.title,
    files: data.files,
    added: data.added,
    removed: data.removed,
    steps: data.steps.length,
    minutes: data.minutes,
    flags,
    walkthrough: data.walkthrough,
    author: data.author,
  };
}
