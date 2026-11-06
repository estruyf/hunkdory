// Projects, their agent branches, and the review data for one branch.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { Worker } from 'node:worker_threads';
import createWtvWorker from './wtv-worker.ts?nodeWorker';
import type { WtvJob, WtvOutput } from './wtv-worker.ts';
import * as g from './git.ts';
import { pathKey } from './paths.ts';
import { detectedIcon, forgetIconFile, projectIconInfo, storeIconChoice } from './projectIcons.ts';
import { belongsTo, readSessions, scanSessionFolders, sessionDirsFor } from './sessions/claude.ts';
import { belongsTo as copilotBelongsTo, readCopilotSessions } from './sessions/copilot.ts';
import * as gh from './github.ts';
import { buildsOn, duplicateBranches, integrationBranches, matchesPattern, matchSessions, weakMatchMainFolder, withCheckoutFallback, type BranchSessions } from './match.ts';
import { attention, buildSteps, estimateMinutes, overview } from './steps.ts';
import { aiReviewSettings } from '../shared/aiReview.ts';
import { projectName, toWatch, withProjectName, type Store } from './store.ts';
import type { GeneratedWalkthroughs } from './writer.ts';
import { asOfNow, type Summaries, type Summary } from './summaries.ts';
import { askAbility } from './conversations.ts';
import { assistantFor } from './assistants/index.ts';
import type { BaseChoice, BranchChoice, UncommittedChoice, BranchInfo, CodeSearchResult, FoundFolder, InboxPreview, ProjectIconInfo, GitHubFeedback, HunkView, IssueRefs, InboxItem, Project, ProjectInput, ProjectScan, PullRequest, RepoCheck, ReviewData, SessionInfo, WalkthroughSource } from '../shared/types.ts';

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
  private cache = new Map<string, { key: string; pr: string; data: ReviewData; full: boolean }>();
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
    const empty: RepoCheck = { path: full, isRepo: false, root: null, baseBranch: null, branches: [], remote: null, sessionSources: [], sessionCount: 0, icon: { icon: null, source: null, path: null } };
    if (!existsSync(full)) return { ...empty, error: 'Folder not found' };
    const root = await g.repoRoot(full);
    if (!root) return { ...empty, error: 'Not a git repository' };
    const [baseBranch, branches, remote, trees] = await Promise.all([g.detectBaseBranch(root), g.localBranches(root), g.remoteUrl(root), g.worktrees(root)]);
    const roots = [root, ...trees.map((t) => t.path)];
    const claudeSessions = readSessions(sessionDirsFor(roots)).filter((s) => belongsTo(s, roots));
    const copilotSessions = readCopilotSessions().filter((s) => copilotBelongsTo(s, roots));
    const perDir = new Map<string, number>();
    for (const s of claudeSessions) perDir.set(s.configDir!, (perDir.get(s.configDir!) ?? 0) + 1);
    const sources = [...perDir].map(([dir, n]) => ({ dir: tilde(dir), sessions: n }));
    if (copilotSessions.length) sources.push({ dir: 'GitHub Copilot', sessions: copilotSessions.length });
    return {
      path: full,
      isRepo: true,
      root,
      baseBranch,
      branches,
      remote,
      sessionSources: sources.sort((a, b) => b.sessions - a.sessions),
      sessionCount: claudeSessions.length + copilotSessions.length,
      icon: detectedIcon(root),
    };
  }

  foundOnThisMac(): FoundFolder[] {
    // Saved paths come from git, session folders from wherever the agent ran: compare them as folders, not strings.
    const known = new Set(this.store.projects().map((p) => pathKey(p.path)));
    const byPath = new Map<string, FoundFolder & { at: number }>();
    const copilot = readCopilotSessions().map((s) => ({ cwd: s.cwd, sessions: 1, lastActive: Date.parse(s.endedAt ?? '') || 0 }));
    for (const f of [...scanSessionFolders(), ...copilot]) {
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
        icon: null,
      });
    }
    return [...byPath.values()].sort((a, b) => b.at - a.at).slice(0, 8).map(({ at: _at, ...f }) => ({ ...f, path: tilde(f.path), icon: detectedIcon(f.path).icon }));
  }

  private async validate(root: string, input: Omit<ProjectInput, 'path'>) {
    if (!(await g.refExists(root, input.baseBranch))) throw new Error(`Base branch "${input.baseBranch}" not found`);
    const w = toWatch(input.watch);
    if (w.pattern !== null && !w.pattern.trim()) throw new Error('Enter a branch pattern, like claude/*');
    if (w.pullRequests && !input.github) throw new Error('Link the GitHub remote to review open pull requests.');
    if (!w.anyBranch && w.pattern === null && !w.pullRequests) throw new Error('Pick at least one kind of branch to review.');
  }

  /** What the inbox would show for a repo you're about to connect, so you can see what you're choosing. */
  async previewInbox(root: string, baseBranch: string, repo: string | null): Promise<InboxPreview> {
    const refs = (await g.tryGit(['for-each-ref', `--format=%(refname:short)%00%(ahead-behind:${baseBranch})`, 'refs/heads'], root)) ?? '';
    const branches = refs.split('\n').filter((l) => {
      const [name, counts] = l.split('\0');
      return name && name !== baseBranch && Number(counts?.split(' ')[0] ?? 0) > 0;
    }).length;
    if (!repo) return { branches, pullRequests: null };
    try {
      return { branches, pullRequests: (await gh.openPullRequests(root, repo)).length };
    } catch (e) {
      return { branches, pullRequests: null, error: (e as Error).message };
    }
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
    const id = randomUUID();
    const icon = input.icon && storeIconChoice(id, input.icon);
    const project: Project = {
      id,
      name: projectName(input.name, check.root),
      path: check.root,
      baseBranch: input.baseBranch,
      remote: check.remote,
      watch: toWatch(input.watch),
      github: input.github,
      writeWalkthroughs: input.writeWalkthroughs,
      assistant: input.assistant,
      ...(input.aiReview && { aiReview: aiReviewSettings(input.aiReview) }),
      ...(icon && { icon }),
      addedAt: new Date().toISOString(),
    };
    this.store.addProject(project);
    // A scan already going read the project list before this one was on it.
    this.scanning = null;
    return project;
  }

  removeProject(id: string) {
    forgetIconFile(this.store.projects().find((p) => p.id === id)?.icon);
    this.icons.delete(id);
    this.store.removeProject(id);
    this.scanning = null;
  }

  // Reading a repo for its icon touches a lot of files, and every screen with a project on it asks.
  private icons = new Map<string, { at: number; info: ProjectIconInfo }>();

  /** What each project shows as its icon. A repo's own icon is looked for again after a minute. */
  projectIcons(): Record<string, ProjectIconInfo> {
    const now = Date.now();
    const out: Record<string, ProjectIconInfo> = {};
    for (const p of this.store.projects()) {
      let hit = this.icons.get(p.id);
      if (!hit || now - hit.at > 60_000) this.icons.set(p.id, (hit = { at: now, info: projectIconInfo(p) }));
      out[p.id] = hit.info;
    }
    return out;
  }

  async updateProject(id: string, input: Omit<ProjectInput, 'path'>): Promise<Project> {
    const project = this.store.project(id);
    await this.validate(project.path, input);
    // Before anything is saved: an image that can't be an icon leaves the settings as they were.
    const icon = input.icon ? storeIconChoice(id, input.icon) : project.icon;
    const updated: Project = {
      ...withProjectName(project, input.name),
      icon,
      baseBranch: input.baseBranch,
      watch: toWatch(input.watch),
      github: input.github,
      writeWalkthroughs: input.writeWalkthroughs ?? project.writeWalkthroughs,
      assistant: input.assistant ?? project.assistant,
      aiReview: input.aiReview ? aiReviewSettings(input.aiReview) : project.aiReview,
      remote: await g.remoteUrl(project.path),
    };
    this.store.addProject(updated);
    forgetIconFile(project.icon, icon);
    this.icons.delete(id);
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

  /** Every checkout with uncommitted work, main folder first. */
  async listUncommitted(projectId: string): Promise<UncommittedChoice[]> {
    const project = this.store.project(projectId);
    const trees = await g.worktrees(project.path);
    const open = new Set((await this.discover(project)).items.filter((d) => d.branch.uncommitted).map((d) => d.branch.name));
    const list: UncommittedChoice[] = [];
    for (const t of trees) {
      if (!t.branch) continue;
      const files = (await g.dirtyFiles(t.path).catch(() => [])).length;
      if (files) list.push({ branch: t.branch, path: tilde(t.path), where: t.path === project.path ? 'main' : 'worktree', files, inInbox: open.has(t.branch) });
    }
    return list;
  }

  /** Reviews only what isn't committed on a checked-out branch: it compares against its own last commit, and stays in the inbox whatever the watch rules. */
  async reviewUncommitted(projectId: string, branch: string): Promise<void> {
    const project = this.store.project(projectId);
    if ((await this.discover(project, branch)).items.find((x) => x.branch.name === branch)?.branch.uncommitted) return;
    this.store.addProject({ ...project, tracked: [...new Set([...(project.tracked ?? []), branch])], ignored: (project.ignored ?? []).filter((b) => b !== branch) });
    this.store.reopenReview(projectId, branch);
    await this.setBase(projectId, branch, branch);
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
    const now = (await this.find(projectId, branch)).d.branch;
    if (now.uncommitted && !now.baseChosen) throw new Error(`These are the uncommitted changes on ${branch}: they always compare against its last commit.`);
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

  /** A "probably" Copilot session match (see `weakMatchMainFolder`) you said wasn't really this branch's. */
  unlinkSession(projectId: string, sessionId: string, on: boolean) {
    const project = this.store.project(projectId);
    const rest = (project.dismissedSessions ?? []).filter((id) => id !== sessionId);
    this.store.addProject({ ...project, dismissedSessions: on ? [...rest, sessionId] : rest });
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

  /**
   * Every session on this Mac that may belong to `project`: Claude Code's and Copilot's, matched to
   * branches where that's a hard fact (a worktree's path, or Claude's own per-message branch), plus a
   * guess for Copilot sessions that ran in the main folder instead of a worktree (see `weakMatchMainFolder`
   * in match.ts). `probable` holds the ids of sessions that are only a guess, so a branch matched only
   * through them can be shown as "probably" and unlinked.
   */
  private async allSessions(project: Project, trees: g.Worktree[]): Promise<{ sessions: SessionInfo[]; found: number; probable: Set<string> }> {
    const root = project.path;
    const roots = [root, ...trees.map((t) => t.path)];
    const claudeFound = readSessions(sessionDirsFor(roots)).filter((s) => belongsTo(s, roots));
    const copilotFound = readCopilotSessions().filter((s) => copilotBelongsTo(s, roots));
    const exclude = integrationBranches([...claudeFound, ...copilotFound], project.baseBranch);
    const claudeSessions = withCheckoutFallback(claudeFound, trees, exclude);
    // A Copilot session that ran in the repo's own folder, not a worktree, can't be told apart by its cwd
    // alone from an old one that ran there on a different branch: only a genuine worktree is a hard match.
    let copilotSessions = withCheckoutFallback(copilotFound, trees.filter((t) => t.path !== root), exclude);
    const dismissed = new Set(project.dismissedSessions ?? []);
    const probable = new Set<string>();
    const guessable = copilotSessions.filter((s) => s.cwd === root && !s.branches.length && !dismissed.has(s.id));
    if (guessable.length) {
      const localNames = await g.localBranches(root);
      const [checkouts, ranges] = await Promise.all([
        g.reflogCheckouts(root),
        Promise.all(localNames.map(async (b) => [b, await g.commitTimeRange(root, b)] as const)),
      ]);
      const commitRanges = new Map(ranges.filter((r): r is [string, { first: string; last: string }] => !!r[1]));
      const weak = weakMatchMainFolder(guessable, checkouts, commitRanges);
      const branchOf = new Map<string, string>();
      for (const [branch, list] of weak) for (const s of list) branchOf.set(s.id, branch);
      copilotSessions = copilotSessions.map((s) => {
        const branch = branchOf.get(s.id);
        if (!branch) return s;
        probable.add(s.id);
        return { ...s, branches: [{ name: branch, firstSeen: s.startedAt ?? '', lastSeen: s.endedAt ?? s.startedAt ?? '' }] };
      });
    }
    return { sessions: [...claudeSessions, ...copilotSessions], found: claudeFound.length + copilotFound.length, probable };
  }

  /** What needs a review in a project, plus counts that explain an empty inbox. */
  /** `only` narrows the work to one branch, for opening a review without scanning the whole project. */
  async discover(project: Project, only?: string): Promise<{ items: Discovered[]; scan: ProjectScan }> {
    const root = project.path;
    const [trees, branches] = await Promise.all([g.worktrees(root), g.localBranches(root)]);
    const { sessions, found, probable } = await this.allSessions(project, trees);
    const exclude = integrationBranches(sessions, project.baseBranch);
    const exists = new Set(branches);
    const scan: ProjectScan = { projectId: project.id, sessions: found, branchesSeen: 0, gone: 0, upToDate: 0, waiting: 0, pullRequests: null };

    // Every branch a session touched, whether it still exists or not, for the scan.
    const seen = new Set(sessions.flatMap((s) => s.branches.map((b) => b.name)).filter((b) => !exclude.has(b)));
    scan.branchesSeen = seen.size;
    scan.gone = [...seen].filter((b) => !exists.has(b)).length;

    // Pull requests first: a branch that is also an open PR shows up once, as the PR.
    // The Copilot coding agent works on GitHub, not on this Mac: its open PRs are agent work even when you don't watch every PR.
    const prs = !project.github
      ? []
      : project.watch.pullRequests
        ? await this.discoverPullRequests(project, sessions, exclude, scan, only, undefined, probable)
        : await this.discoverPullRequests(project, sessions, exclude, scan, only, (p) => p.copilot, probable);
    const skip = new Set(prs.map((d) => d.branch.name));
    let items = [...prs, ...(await this.discoverBranches(project, sessions, branches, trees, exclude, scan, { skip, only }, probable))];
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
    opts: { skip?: Set<string>; only?: string } = {},
    probable?: Set<string>
  ): Promise<Discovered[]> {
    const root = project.path;
    const exists = new Set(branches);
    // Look up sessions by branch name even when only the remote branch is left.
    const matched = matchSessions(sessions, { exists: () => true, exclude, probable });
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
          // Compared against its own last commit: only what isn't committed yet.
          uncommitted: chosen === name,
          sessionIds: match?.sessions.map((s) => s.id) ?? [],
        },
        match,
      });
    }

    // Uncommitted work on a base branch, like an agent that edited main in your main folder: just those edits, against the last commit.
    if (project.watch.anyBranch) {
      for (const tree of trees) {
        const name = tree.branch;
        if (!name || !exclude.has(name) || names.has(name) || skipped(name)) continue;
        if (opts.only && name !== opts.only) continue;
        const dirty = (await g.dirtyFiles(tree.path)).length;
        if (!dirty) continue;
        out.push({
          branch: {
            projectId: project.id,
            name,
            checkout: { kind: tree.path === root ? 'main' : 'worktree', path: tree.path },
            baseRef: name,
            baseName: name,
            baseChosen: false,
            headRef: name,
            headSha: tree.head,
            pr: null,
            tracked: false,
            dirtyFiles: dirty,
            uncommitted: true,
            sessionIds: [],
          },
          match: null,
        });
      }
    }
    return out;
  }

  /** Every open pull request, fetched into refs/reviewer/*. A local session on the PR's branch adds the prompt and send back. */
  private async discoverPullRequests(project: Project, sessions: SessionInfo[], exclude: Set<string>, scan: ProjectScan, only?: string, filter?: (p: PullRequest) => boolean, probable?: Set<string>): Promise<Discovered[]> {
    const root = project.path;
    let prs: PullRequest[];
    try {
      prs = (await gh.openPullRequests(root, project.github!)).filter((p) => !filter || filter(p));
    } catch (e) {
      scan.error = (e as Error).message;
      return [];
    }
    // A fetch that fails, say offline, still leaves the PRs fetched before: those whose head hasn't moved since stay.
    let fetched = true;
    try {
      await gh.fetchPullRequests(root, project.github!, only ? prs.filter((p) => p.headRefName === only) : prs);
    } catch (e) {
      scan.error = (e as Error).message;
      fetched = false;
    }
    if (!filter) scan.pullRequests = prs.length;
    const matched = matchSessions(sessions, { exists: () => true, exclude, probable });
    // A PR's branch checked out on this Mac, at the PR's commit or with commits made here on top, is where Claude can
    // change it and Hunkdory pushes from. So is one with the PR's files on other commits, as after the PR was rebased:
    // the push moves it onto the PR's head first. One behind the PR isn't the PR.
    const trees = await g.worktrees(root).catch(() => [] as g.Worktree[]);
    const out: Discovered[] = [];
    for (const pr of prs) {
      if (only && pr.headRefName !== only) continue;
      const headRef = gh.prRef(pr.number);
      const chosen = await chosenBase(project, pr.headRefName);
      const baseRef = chosen ?? gh.baseRef(pr.baseRefName);
      if (!(await g.refExists(root, headRef)) || !(await g.refExists(root, baseRef))) continue;
      if (!fetched && (await g.tryGit(['rev-parse', headRef], root))?.trim() !== pr.headRefOid) continue;
      const match = matched.get(pr.headRefName) ?? null;
      const named = pr.fork ? undefined : trees.find((t) => t.branch === pr.headRefName);
      const at = named ? await prRelation(root, named.head, pr.headRefOid) : null;
      const tree = at ? named : undefined;
      const ahead = at === 'ahead' ? Number((await g.tryGit(['rev-list', '--count', `${pr.headRefOid}..${named!.head}`], root))?.trim() || 0) : 0;
      out.push({
        branch: {
          projectId: project.id,
          name: pr.headRefName,
          checkout: tree ? { kind: tree.path === root ? 'main' : 'worktree', path: tree.path } : { kind: 'none' },
          baseRef,
          baseName: chosen ?? pr.baseRefName,
          baseChosen: !!chosen,
          headRef,
          headSha: pr.headRefOid,
          pr,
          tracked: false,
          dirtyFiles: tree ? (await g.dirtyFiles(tree.path)).length : 0,
          ahead,
          uncommitted: false,
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
      // On a base branch, a committed walkthrough is about work merged long ago: only one written for these edits counts.
      const forThis = !d.branch.uncommitted || !!(await g.tryGit(['status', '--porcelain', '--untracked-files=all', '--', '.review/walkthrough.json'], d.branch.checkout.path))?.trim();
      if (forThis && existsSync(file)) text = readFileSync(file, 'utf8');
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
    const { items, scan } = await this.discover(project, branch);
    const d = items.find((x) => x.branch.name === branch);
    // GitHub couldn't be read, such as gh being signed out: that says more than guessing the branch is gone.
    if (!d && scan.error) throw new Error(`Couldn't read ${branch}: ${scan.error}`);
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

  /** Reviews and line comments on the branch's PR. Null when there's none, or GitHub can't be read: the review goes on without. */
  private async feedback(project: Project, d: Discovered): Promise<GitHubFeedback | null> {
    const pr = d.branch.pr;
    if (!pr || !project.github) return null;
    return gh.prFeedback(project.path, project.github, pr.number).catch(() => null);
  }

  /** What the review shows from GitHub that changes while the diff doesn't. */
  private async fromGitHub(project: Project, d: Discovered, prompt: string | null) {
    const [github, references] = await Promise.all([this.feedback(project, d), this.references(project, d, prompt)]);
    return { github, references };
  }

  /** What "#123" means in the branch's PR and prompt. The links don't depend on a PR, as long as GitHub is linked. */
  private async references(project: Project, d: Discovered, prompt: string | null): Promise<IssueRefs | null> {
    if (!project.github) return null;
    const pr = d.branch.pr;
    const repoUrl = pr ? pr.url.replace(/\/pull\/\d+$/, '') : `https://github.com/${project.github}`;
    return gh.issueReferences(project.path, project.github, repoUrl, [pr?.title, pr?.body, prompt]);
  }

  /** Replies to, or resolves, a review thread on the branch's PR. Returns what's on the PR now. */
  async onGitHub(projectId: string, branch: string, threadId: string, act: { reply: string } | { resolved: boolean }): Promise<GitHubFeedback | null> {
    const { project, d } = await this.find(projectId, branch);
    const pr = d.branch.pr;
    if (!pr || !project.github) throw new Error('This branch has no pull request on GitHub.');
    if ('reply' in act) await gh.replyToThread(project.path, project.github, pr.number, threadId, act.reply);
    else await gh.resolveThread(project.path, project.github, pr.number, threadId, act.resolved);
    return this.feedback(project, d);
  }

  /**
   * Checks a pull request's branch out in a worktree next to the project's folder, tracking the PR's branch on
   * GitHub, so Claude has somewhere to change it and Hunkdory can push the change. A local branch of the same name
   * is used when the PR only adds to it; one with commits the PR doesn't have is left alone.
   */
  async checkoutPullRequest(projectId: string, branch: string): Promise<string> {
    const { project, d } = await this.find(projectId, branch);
    const pr = d.branch.pr;
    if (!pr || !project.github) throw new Error('This branch has no pull request on GitHub.');
    if (d.branch.checkout.kind !== 'none') return d.branch.checkout.path;
    if (pr.fork) throw new Error(`PR #${pr.number} comes from a fork, so Hunkdory can't push to it. Check it out yourself with "gh pr checkout ${pr.number}".`);
    const root = project.path;
    const name = pr.headRefName;
    const head = gh.prRef(pr.number);
    const done = (path: string) => {
      // The review read before has nowhere to change it.
      this.cache.delete(`${project.id}::${name}`);
      return path;
    };
    // Already checked out, behind the PR: bring it up to date when nothing local is in the way.
    const there = (await g.worktrees(root)).find((t) => t.branch === name);
    if (there) {
      if ((await g.dirtyFiles(there.path)).length) throw new Error(`${name} is checked out in ${tilde(there.path)} with uncommitted changes, and it's behind PR #${pr.number}. Commit or stash them there first.`);
      if ((await g.tryGit(['merge', '--ff-only', '--quiet', head], there.path)) === null) throw new Error(`${name} in ${tilde(there.path)} has commits PR #${pr.number} doesn't. Push or reset them first.`);
      return done(there.path);
    }
    const local = await g.tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], root);
    if (local) {
      if ((await g.tryGit(['merge-base', '--is-ancestor', `refs/heads/${name}`, head], root)) === null) throw new Error(`Your local ${name} has commits PR #${pr.number} doesn't. Push or reset it first.`);
      await g.git(['branch', '-f', name, head], root);
    }
    const path = join(dirname(root), `${basename(root)}-worktrees`, name.replace(/[/\\]/g, '-'));
    if (existsSync(path)) throw new Error(`${tilde(path)} already exists. Move it aside first.`);
    await g.git(local ? ['worktree', 'add', '--quiet', path, name] : ['worktree', 'add', '--quiet', '-b', name, path, head], root);
    // Pushes go to the PR's branch on GitHub.
    const remote = await gh.remoteFor(root, project.github);
    await g.git(['config', `branch.${name}.remote`, remote], root);
    await g.git(['config', `branch.${name}.merge`, `refs/heads/${name}`], root);
    return done(path);
  }

  /** Commits what changed in the pull request's checkout, if anything, and pushes the branch to the PR. Never forced. */
  async pushToPullRequest(projectId: string, branch: string, message: string): Promise<string> {
    const { project, d } = await this.find(projectId, branch);
    const pr = d.branch.pr;
    if (!pr || !project.github) throw new Error('This branch has no pull request on GitHub.');
    if (d.branch.checkout.kind === 'none') throw new Error(`PR #${pr.number} isn't checked out on this Mac, or it's behind the PR there.`);
    const wt = d.branch.checkout.path;
    if ((await g.currentBranch(wt)) !== pr.headRefName) throw new Error(`The folder with these changes is no longer on ${pr.headRefName}. Reload the review.`);
    // The PR was rebased under the checkout: its branch goes onto the PR's head, so the push isn't a forced one.
    const head = (await g.git(['rev-parse', 'HEAD'], wt)).trim();
    if ((await prRelation(project.path, head, pr.headRefOid)) === 'rebased') await g.git(['reset', '--soft', '--quiet', pr.headRefOid], wt);
    const files = (await g.dirtyFiles(wt)).length;
    if (files) {
      await g.git(['add', '-A', '--', '.', ':(exclude).review'], wt);
      await g.git(['commit', '--quiet', '-m', message.trim() || 'Address review feedback'], wt).catch((e: { stderr?: string; stdout?: string; message: string }) => {
        // A hook that turned the commit down says why on its own output; the command line adds nothing.
        const why = (e.stderr || e.stdout || '').trim().split('\n').slice(-6).join('\n') || e.message;
        throw new Error(`Couldn't commit: ${why}`);
      });
    }
    await gh.pushBranch(project.path, project.github, pr.headRefName);
    // GitHub's list can lag behind a push for a moment: wait for it, or the plan goes on saying the commits aren't on the PR.
    const pushed = (await g.git(['rev-parse', 'HEAD'], wt)).trim();
    for (let i = 0; i < 6; i++) {
      gh.forget(project.github);
      const now = await gh.openPullRequests(project.path, project.github).catch(() => []);
      if (now.find((p) => p.number === pr.number)?.headRefOid === pushed) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    this.cache.delete(`${project.id}::${pr.headRefName}`);
    return files ? `Committed ${files} file${files === 1 ? '' : 's'} and pushed to PR #${pr.number}.` : `Pushed the commits on this Mac to PR #${pr.number}.`;
  }

  /** The PR stack this branch is in, with the branch name Hunkdory opens each PR's review by. */
  private async stack(project: Project, d: Discovered): Promise<ReviewData['stack']> {
    const pr = d.branch.pr;
    if (!pr || !project.github) return null;
    const prs = await gh.openPullRequests(project.path, project.github).catch(() => [] as PullRequest[]);
    const st = gh.stackOf(prs, pr.number);
    if (!st) return null;
    const me = await gh.login(project.path).catch(() => null);
    const entries = [];
    for (const p of st.prs) {
      const branch =
        p.number === pr.number
          ? d.branch.name
          : project.watch.pullRequests ||(await g.refExists(project.path, `refs/heads/${p.headRefName}`))
            ? p.headRefName
            : `origin/${p.headRefName}`;
      const state = this.store.review(project.id, branch);
      entries.push({
        number: p.number,
        title: p.title,
        branch,
        url: p.url,
        current: p.number === pr.number,
        status: state?.status ?? null,
        changed: !!state?.decision?.headSha && state.decision.headSha !== p.headRefOid,
        github: (me && p.reviews.find((r) => r.login === me)?.state) || null,
      });
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
    // The PR comes and goes without a commit, as when you open one from Finish: a review read before it is stale.
    // Its checks and update time change all the time without changing anything else, so they're taken fresh.
    const p = d.branch.pr;
    const prKey = p ? JSON.stringify([p.number, p.headRefOid, p.baseRefName, p.title, p.author, p.copilot]) : '';
    const hit = this.cache.get(cacheId);
    // The stack holds your reviews of the other PRs in it, and GitHub holds what others said: both change while
    // this diff doesn't, so they're taken fresh. The inbox (no lines) has no use for the comments.
    if (!refresh && hit?.key === key && hit.pr === prKey && (hit.full || !lines)) return { ...hit.data, pr: p, stack: await this.stack(project, d), ...(lines ? await this.fromGitHub(project, d, hit.data.prompt) : {}) };

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
    // The last commit on a base branch says nothing about edits made after it.
    const title = d.branch.uncommitted
      ? (authorTitle ?? reviewerTitle ?? intent ?? `Uncommitted changes on ${d.branch.name}`)
      : (authorTitle ?? d.branch.pr?.title ?? d.match?.origin.title ?? promptTitle ?? reviewerTitle ?? subject ?? intent ?? d.branch.name);

    const shared = (wt.value as { shared?: { url: string; by: string } } | null)?.shared;
    const me = d.branch.pr ? await gh.login(root).catch(() => null) : null;
    const assistant = assistantFor(project);
    const data: ReviewData = {
      ask: askAbility(session, d.branch, assistant.id === 'manual'),
      assistant: assistant.id === 'manual' ? null : { id: assistant.id, name: assistant.name },
      aiReviewSettings: aiReviewSettings(project.aiReview),
      agent: d.match ? d.match.origin.agent : d.branch.pr?.copilot ? 'copilot' : null,
      headSha: d.branch.headSha,
      dirty: d.branch.dirtyFiles > 0,
      dirtyFiles: d.branch.dirtyFiles,
      ahead: d.branch.ahead ?? 0,
      uncommitted: d.branch.uncommitted,
      stack: await this.stack(project, d),
      github: null,
      references: null,
      walkthroughFromSession: source === 'reviewer' && (wt.value as { generatedBy?: { fromSession?: boolean } } | null)?.generatedBy?.fromSession === true,
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
      githubLogin: me,
      prByYou: !!d.branch.pr && d.branch.pr.author === me,
      local: !d.branch.pr && !d.branch.uncommitted && d.branch.headRef === d.branch.name && (await g.refExists(root, `refs/heads/${d.branch.name}`)),
      author: d.match || d.branch.uncommitted ? null : author || null,
      walkthrough: source,
      intent,
      ...overview(r, steps),
      title,
      prompt,
      session,
      sessionProbable: d.match?.probable ?? false,
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
    this.cache.set(cacheId, { key, pr: prKey, data, full: lines });
    return lines ? { ...data, ...(await this.fromGitHub(project, d, data.prompt)) } : data;
  }

  private scanning: Promise<InboxScan> | null = null;
  /** The last scan, so one project can be read again without the others. */
  private last: InboxScan | null = null;

  /** The inbox as the last scan left it, even one from an earlier run, to show while a new scan runs. Null with nothing to show: that's not the same as an empty inbox. */
  cachedInbox(): InboxScan | null {
    const saved = this.last ?? this.summaries.lastScan;
    const now = saved && asOfNow(saved, this.store.projects(), (projectId, branch) => this.store.review(projectId, branch));
    return now?.items.length ? now : null;
  }

  /**
   * Two screens asking at once share one scan. `projectId` reads that project alone and keeps the others as the
   * last scan saw them; `refetch` asks GitHub again rather than use the pull requests read in the last minute.
   */
  inbox(refresh = false, opts: { projectId?: string; refetch?: boolean } = {}): Promise<InboxScan> {
    const only = opts.projectId ? this.store.projects().find((p) => p.id === opts.projectId) : undefined;
    if (opts.refetch) for (const p of only ? [only] : this.store.projects()) if (p.github) gh.forget(p.github);
    // Before the first scan there are no others to keep: read them all.
    if (only && (this.last || this.scanning)) return (this.scanning ?? Promise.resolve()).catch(() => {}).then(() => this.scanProject(only, refresh));
    if (this.scanning && !refresh && !opts.refetch) return this.scanning;
    const run = this.scanInbox(refresh).finally(() => {
      if (this.scanning === run) this.scanning = null;
    });
    this.scanning = run;
    return run;
  }

  private async scanProject(project: Project, refresh: boolean): Promise<InboxScan> {
    const last = this.last ?? { items: [], scans: [], me: null };
    const { items, scan } = await this.projectInbox(project, refresh, new Set(), Promise.resolve(last.me));
    const ids = new Set(this.store.projects().map((p) => p.id));
    const scans = last.scans.filter((s) => ids.has(s.projectId) && s.projectId !== project.id);
    const at = last.scans.findIndex((s) => s.projectId === project.id);
    scans.splice(at === -1 ? scans.length : at, 0, scan);
    const next = { items: [...last.items.filter((i) => ids.has(i.projectId) && i.projectId !== project.id), ...items].sort(newestFirst), scans, me: last.me };
    this.last = next;
    this.summaries.rememberScan(next);
    return next;
  }

  private async scanInbox(refresh: boolean): Promise<InboxScan> {
    const listed = new Set<string>();
    // Who "you" are on GitHub, for the People filter. Asked once per run, alongside the scan.
    const linked = this.store.projects().find((p) => p.github);
    const me = linked ? gh.login(linked.path).catch(() => null) : Promise.resolve(null);
    // Projects are read side by side: most of the time goes to waiting on git and gh.
    const per = await Promise.all(this.store.projects().map((p) => this.projectInbox(p, refresh, listed, me)));
    this.summaries.keepOnly(listed);
    const items = per.flatMap((r) => r.items);
    items.sort(newestFirst);
    this.last = { items, scans: per.map((r) => r.scan), me: await me };
    this.summaries.rememberScan(this.last);
    return this.last;
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
        const finished = state?.status === 'discarded' || state?.status === 'merged' || state?.status === 'reviewed';
        if (!d.branch.uncommitted && (state?.status === 'discarded' || state?.status === 'merged')) return null;
        // After you reviewed or sent it back, it only needs you again once it changed.
        const decidedOn = state?.decision?.headSha;
        let updatedSinceReview = !!decidedOn && decidedOn !== d.branch.headSha;
        if (!d.branch.uncommitted && state?.status === 'reviewed' && !updatedSinceReview) return null;
        // Uncommitted work has no commit to tell rounds apart: it's done while every edit in it is one you finished with.
        if (d.branch.uncommitted && finished) {
          const seen = new Set(state.decision?.hunkIds ?? []);
          const now = await this.reviewFor(project, d, { lines: false }).catch(() => null);
          if (now && Object.keys(now.hunks).every((id) => seen.has(id))) return null;
          updatedSinceReview = true;
        }
        const pr = d.branch.pr;
        const agentName = (a: 'claude-code' | 'copilot') => (a === 'copilot' ? 'GitHub Copilot' : 'Claude Code');
        const who = d.match
          ? `${d.match.probable ? 'Probably ' : ''}${agentName(d.match.origin.agent)}${d.match.sessions.length > 1 ? ` · ${d.match.sessions.length} sessions` : ''}`
          : pr?.copilot
            ? 'GitHub Copilot'
            : pr
              ? `by ${pr.author}`
              : d.branch.uncommitted
                ? 'Uncommitted changes'
                : 'No agent session';
        const id = `${project.id}::${d.branch.name}`;
        listed.add(id);
        // A local branch is "opened" by whoever made its newest commit; one git call also gives its date.
        // Uncommitted work is on this Mac, so it's yours, and as new as its newest edit.
        const [authorName, authorEmail, committed] = pr ? [] : d.branch.uncommitted ? [undefined, undefined, await lastEdit((d.branch.checkout as { path: string }).path)] : ((await g.tryGit(['log', '-1', '--format=%an%x00%ae%x00%cI', d.branch.headRef], project.path))?.trim().split('\0') ?? []);
        const you = await gitUser;
        const prAuthor = pr && pr.author !== 'unknown' ? pr.author : null;
        const openedBy = pr ? prAuthor : authorName || null;
        const openedByYou = pr ? !!prAuthor && prAuthor === (await me) : d.branch.uncommitted || (!!you.email && authorEmail?.toLowerCase() === you.email) || (!!you.name && authorName === you.name);
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
          uncommitted: d.branch.uncommitted,
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
          // Uncommitted work is newer than any session's title or commit on the branch.
          return { ...base, ...sum, title: base.title === d.branch.name || d.branch.uncommitted ? sum.title : base.title, agent: sum.author && !d.match && !pr ? `by ${sum.author}` : base.agent };
        } catch (e) {
          return { ...base, error: (e as Error).message };
        }
      })
    );
    return { items: items.filter((x): x is InboxItem => !!x), scan };
  }
}

export type InboxScan = { items: InboxItem[]; scans: ProjectScan[]; me: string | null };

const newestFirst = (a: InboxItem, b: InboxItem) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');

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

/**
 * How a checkout's commit stands to a PR's head: at it, ahead of it with commits made here, or `rebased`: the same
 * files on other commits, as when the PR was rebased after it was checked out. Null: it's behind, or elsewhere.
 */
async function prRelation(root: string, head: string, prHead: string): Promise<'at' | 'ahead' | 'rebased' | null> {
  if (head === prHead) return 'at';
  if ((await g.tryGit(['merge-base', '--is-ancestor', prHead, head], root)) !== null) return 'ahead';
  if ((await g.tryGit(['diff', '--quiet', prHead, head], root)) !== null) return 'rebased';
  return null;
}

/** When the newest uncommitted edit in a checkout was made. */
async function lastEdit(path: string): Promise<string | undefined> {
  let at = 0;
  for (const f of await g.dirtyFiles(path)) {
    try {
      at = Math.max(at, statSync(join(path, f)).mtimeMs);
    } catch {}
  }
  return at ? new Date(at).toISOString() : undefined;
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
