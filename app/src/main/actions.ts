// Finishing a review: merge locally, send back to the agent, or discard.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import * as g from './git.ts';
import * as gh from './github.ts';
import type { Projects } from './projects.ts';
import type { Store } from './store.ts';
import { shellEnv, which } from './shellEnv.ts';
import { DEFAULT_CONFIG_DIR } from './sessions/claude.ts';
import type { Comment, DecisionRecord, FinishRequest, FinishResult, ReviewData, ReviewState, Step } from '../shared/types.ts';

const where = (c: Comment) => (c.path && c.line ? ` at ${c.path}:${c.line}${c.side === 'LEFT' ? ' (removed line)' : ''}` : '');

/** The message a resumed agent session gets. Plain text, one item per comment. */
export function sendBackPrompt(data: Pick<ReviewData, 'steps'>, state: Pick<ReviewState, 'comments'>, req: Pick<FinishRequest, 'note' | 'dropStepKeys'>, wtvCommand: string): string {
  const stepOf = (key: string) => data.steps.find((s) => s.key === key);
  const label = (s: Step | undefined) => (s ? `Step ${s.index + 1} "${s.title}" (${s.files.join(', ') || 'no files'})` : 'A step that no longer exists');
  const lines = ['I reviewed your changes on this branch in Reviewer. Please address the feedback below.', ''];
  if (state.comments.length) {
    lines.push('Comments:');
    for (const c of state.comments) lines.push(`- ${label(stepOf(c.stepKey))}${where(c)}: ${c.body.trim()}`);
    lines.push('');
  }
  const drops = req.dropStepKeys.map(stepOf).filter((s): s is Step => !!s);
  if (drops.length) {
    lines.push('Drop these steps: revert their changes so they are no longer part of the branch:');
    for (const s of drops) lines.push(`- ${label(s)}`);
    lines.push('');
  }
  if (req.note.trim()) lines.push(`Note: ${req.note.trim()}`, '');
  lines.push(
    `When you're done, update .review/walkthrough.json so it describes the branch as it is now, and run \`${wtvCommand}\` until it passes.`
  );
  return lines.join('\n');
}

/**
 * Your review as a GitHub review: line comments on their lines, step comments and the note in the text.
 * With `inline` false (the PR moved on, or you reviewed uncommitted work) line comments go into the text too. Pure.
 */
export function githubReview(
  data: Pick<ReviewData, 'steps'>,
  state: Pick<ReviewState, 'comments'>,
  req: Pick<FinishRequest, 'note' | 'dropStepKeys'>,
  opts: { inline: boolean; copilot: boolean }
): { body: string; comments: gh.LineComment[] } {
  const stepOf = (key: string) => data.steps.find((s) => s.key === key);
  const label = (s: Step | undefined) => (s ? `Step ${s.index + 1}: ${s.title}` : 'A step that no longer exists');
  const parts: string[] = [];
  if (opts.copilot) parts.push('@copilot Please address this review.');
  if (req.note.trim()) parts.push(req.note.trim());
  const inline: gh.LineComment[] = [];
  const folded: string[] = [];
  for (const c of state.comments.filter((c) => c.body.trim())) {
    if (c.path && c.line && c.side) {
      if (opts.inline) inline.push({ path: c.path, line: c.line, side: c.side, body: c.body.trim() });
      else folded.push(`**\`${c.path}:${c.line}\`**${c.side === 'LEFT' ? ' (removed line)' : ''}\n${c.body.trim()}`);
    } else {
      const s = stepOf(c.stepKey);
      folded.push(`**${label(s)}**${s?.files.length ? ` (${s.files.map((f) => `\`${f}\``).join(', ')})` : ''}\n${c.body.trim()}`);
    }
  }
  parts.push(...folded);
  const drops = req.dropStepKeys.map(stepOf).filter((s): s is Step => !!s);
  if (drops.length) parts.push(['Please drop these changes, they are outside the task:', ...drops.map((s) => `- ${label(s)} (${s.files.map((f) => `\`${f}\``).join(', ')})`)].join('\n'));
  parts.push('<sub>Reviewed step by step with Reviewer.</sub>');
  return { body: parts.join('\n\n'), comments: inline };
}

/** The description of a pull request Reviewer opens for a branch you approved. Pure. */
export function prDescription(data: Pick<ReviewData, 'steps' | 'intent' | 'prompt'>, state: Pick<ReviewState, 'comments'>, note: string): string {
  const stepOf = (key: string) => data.steps.find((s) => s.key === key);
  const parts: string[] = [];
  const goal = data.intent?.trim() || data.prompt?.trim().split('\n')[0];
  if (goal) parts.push(goal);
  if (note.trim()) parts.push(note.trim());
  const comments = state.comments.filter((c) => c.body.trim());
  if (comments.length) {
    parts.push(
      ['### Review notes', ...comments.map((c) => {
        const s = stepOf(c.stepKey);
        const at = c.path && c.line ? ` (\`${c.path}:${c.line}\`)` : '';
        return `- **${s ? `Step ${s.index + 1}: ${s.title}` : 'Earlier step'}**${at}: ${c.body.trim().replace(/\n+/g, ' ')}`;
      })].join('\n')
    );
  }
  parts.push('<sub>Reviewed step by step with Reviewer.</sub>');
  return parts.join('\n\n');
}

export class Actions {
  private store: Store;
  private projects: Projects;
  private logDir: string;
  private wtvBin: string;
  private onChange: () => void;

  constructor(opts: { store: Store; projects: Projects; logDir: string; wtvBin: string; onChange: () => void }) {
    this.store = opts.store;
    this.projects = opts.projects;
    this.logDir = opts.logDir;
    this.wtvBin = opts.wtvBin;
    this.onChange = opts.onChange;
  }

  async finish(req: FinishRequest): Promise<FinishResult> {
    const data = await this.projects.review(req.projectId, req.branch);
    const state = this.store.ensureReview(req.projectId, req.branch, { title: data.title, sessionId: data.session?.id ?? null });
    const summary = { files: data.files, added: data.added, removed: data.removed, steps: data.steps.length };
    this.seen = { headSha: data.headSha, hunkIds: Object.keys(data.hunks) };
    try {
      if (req.kind === 'merge' && data.pr) return await this.mergePr(req, data, state, summary);
      if (req.kind === 'merge' && req.openPr) return await this.openPr(req, data, state, summary);
      if (req.kind === 'merge') return await this.merge(req, data, summary);
      if (req.kind === 'github') return await this.postReview(req, data, state, summary);
      if (req.kind === 'send-back' && data.agent === 'copilot') return await this.postReview({ ...req, event: 'REQUEST_CHANGES' }, data, state, summary, true);
      if (req.kind === 'send-back') return await this.sendBack(req, data, state, summary);
      return await this.discard(req, summary);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  private record(req: FinishRequest, status: ReviewState['status'], result: 'ok' | 'running', message: string, summary: ReviewState['summary'], extra: Partial<DecisionRecord> = {}) {
    return this.store.updateReview(req.projectId, req.branch, (r) => {
      r.status = status;
      r.summary = summary;
      r.decision = { kind: req.kind, note: req.note, dropStepKeys: req.dropStepKeys, at: new Date().toISOString(), result, message, ...this.seen, ...extra };
    });
  }

  /** The branch as you saw it, kept with the decision: the next round shows what changed since. */
  private seen: Pick<DecisionRecord, 'headSha' | 'hunkIds'> = {};

  private async postReview(req: FinishRequest, data: ReviewData, state: ReviewState, summary: ReviewState['summary'], toCopilot = false): Promise<FinishResult> {
    const { project, pr, repo } = await this.projects.pullRequest(req.projectId, req.branch);
    const event = req.event ?? 'COMMENT';
    const comments = state.comments.filter((c) => c.body.trim());
    if (event !== 'APPROVE' && !comments.length && !req.note.trim() && !req.dropStepKeys.length) throw new Error('Add a comment or a note first, or approve.');
    // Line numbers only fit GitHub's diff when you reviewed exactly the PR's head.
    const inline = data.headSha === pr.headRefOid && !data.dirty;
    const review = githubReview(data, state, req, { inline, copilot: toCopilot });
    const posted = await gh.postReview(project.path, repo, pr.number, { commitId: pr.headRefOid, body: review.body, event, comments: review.comments });
    const how = event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Requested changes on' : 'Commented on';
    const moved = review.comments.length && !posted.inline ? ' GitHub couldn’t place the line comments, so they are in the review text.' : !inline && comments.some((c) => c.path) ? ' The PR differs from what you reviewed, so line comments are in the review text.' : '';
    const message = toCopilot ? `Posted your review on PR #${pr.number} for Copilot. It picks it up on GitHub and pushes new commits.${moved}` : `${how} PR #${pr.number} on GitHub.${moved}`;
    const r = this.record(req, toCopilot ? 'sent-back' : 'reviewed', 'ok', message, summary, { github: { event, url: posted.url } });
    return { ok: true, message, review: r };
  }

  /** Approves the pull request on GitHub, with your comments, then merges it there. */
  private async mergePr(req: FinishRequest, data: ReviewData, state: ReviewState, summary: ReviewState['summary']): Promise<FinishResult> {
    const { project, pr, repo } = await this.projects.pullRequest(req.projectId, req.branch);
    if (data.headSha !== pr.headRefOid) throw new Error(`PR #${pr.number} changed since you opened this review. Reload it and look at what's new first.`);
    const comments = state.comments.filter((c) => c.body.trim());
    const review = githubReview(data, state, { ...req, dropStepKeys: [] }, { inline: !data.dirty, copilot: false });
    let url: string | null = null;
    let approved = true;
    try {
      url = (await gh.postReview(project.path, repo, pr.number, { commitId: pr.headRefOid, body: review.body, event: 'APPROVE', comments: review.comments })).url;
    } catch (e) {
      // GitHub won't let you approve your own PR. Your comments still go on it; the merge goes ahead.
      if (!gh.isOwnPrError(e)) throw e;
      approved = false;
      if (comments.length || req.note.trim()) url = (await gh.postReview(project.path, repo, pr.number, { commitId: pr.headRefOid, body: review.body, event: 'COMMENT', comments: review.comments })).url;
    }
    const method = await gh.mergePullRequest(project.path, repo, pr.number, pr.headRefOid, pr.title);
    const how = method === 'merge' ? 'Merged' : method === 'squash' ? 'Squashed and merged' : 'Rebased and merged';
    const message = `${approved ? 'Approved and m' : 'M'}${how.slice(1)} PR #${pr.number} into ${pr.baseRefName}.${approved ? '' : ' GitHub doesn’t let you approve your own PR, so it was merged without an approval.'}`;
    const r = this.record(req, 'merged', 'ok', message, summary, { github: { event: approved ? 'APPROVE' : 'COMMENT', url } });
    return { ok: true, message, review: r };
  }

  /** Pushes the branch and opens a pull request for it, with your comments in the description. */
  private async openPr(req: FinishRequest, data: ReviewData, state: ReviewState, summary: ReviewState['summary']): Promise<FinishResult> {
    const { project, d } = await this.projects.find(req.projectId, req.branch);
    if (!project.github) throw new Error('Link the GitHub remote in the project settings first.');
    const needs = await this.commitFirst(req, d, data);
    if (needs) return needs;
    const base = d.branch.baseRef.replace(/^origin\//, '').replace(/^refs\/reviewer\/base\//, '');
    await gh.pushBranch(project.path, project.github, req.branch);
    const pr = await gh.createPullRequest(project.path, project.github, {
      head: req.branch,
      base,
      title: req.openPr!.title,
      body: prDescription(data, state, req.note),
      draft: req.openPr!.draft,
    });
    const message = `Pushed ${req.branch} and opened ${req.openPr!.draft ? 'draft ' : ''}PR #${pr.number} into ${base}.`;
    const r = this.record(req, 'reviewed', 'ok', message, summary, { github: { event: 'APPROVE', url: pr.url } });
    return { ok: true, message, review: r };
  }

  /** Uncommitted work in the branch's worktree: ask first, or commit it when you said so. */
  private async commitFirst(req: FinishRequest, d: Awaited<ReturnType<Projects['find']>>['d'], data: ReviewData): Promise<FinishResult | null> {
    if (d.branch.checkout.kind !== 'worktree' || !d.branch.dirtyFiles) return null;
    if (!req.commitFirst) return { ok: false, needsCommit: d.branch.dirtyFiles, message: `${d.branch.dirtyFiles} file(s) on this branch aren't committed yet.` };
    const wt = d.branch.checkout.path;
    await g.git(['add', '-A', '--', '.', ':(exclude).review'], wt);
    await g.git(['commit', '-m', data.title, '-m', 'Committed by Reviewer before finishing the review.'], wt);
    return null;
  }

  private async merge(req: FinishRequest, data: ReviewData, summary: ReviewState['summary']): Promise<FinishResult> {
    const { project, d } = await this.projects.find(req.projectId, req.branch);
    if (d.branch.pr) throw new Error(`This is pull request #${d.branch.pr.number}. Merge it on GitHub.`);
    const root = project.path;
    const base = d.branch.baseRef.replace(/^origin\//, '');
    if (!(await g.refExists(root, `refs/heads/${base}`))) throw new Error(`There is no local "${base}" branch to merge into.`);
    if (d.branch.checkout.kind === 'main') throw new Error(`Your main folder has ${req.branch} checked out. Switch it to ${base} first, then merge.`);
    const current = await g.currentBranch(root);
    if (current !== base) throw new Error(`Your main folder is on "${current ?? 'a detached HEAD'}". Switch it to ${base} first, then merge.`);
    if ((await g.dirtyFiles(root)).length) throw new Error(`Your main folder has uncommitted changes. Commit or stash them first.`);

    if (d.branch.checkout.kind === 'worktree' && d.branch.dirtyFiles) {
      if (!req.commitFirst) return { ok: false, needsCommit: d.branch.dirtyFiles, message: `${d.branch.dirtyFiles} file(s) on this branch aren't committed yet. They are not part of a merge.` };
      const wt = d.branch.checkout.path;
      await g.git(['add', '-A', '--', '.', ':(exclude).review'], wt);
      await g.git(['commit', '-m', data.title, '-m', 'Committed by Reviewer before merging.'], wt);
    }

    try {
      await g.git(['merge', '--no-ff', '-m', `Merge branch '${req.branch}': ${data.title}`, req.branch], root);
    } catch (e) {
      await g.tryGit(['merge', '--abort'], root);
      const detail = String((e as { stdout?: string }).stdout ?? (e as Error).message).trim().split('\n').slice(-3).join(' ');
      throw new Error(`The merge stopped with conflicts, so nothing changed. ${detail}`);
    }
    const review = this.record(req, 'merged', 'ok', `Merged ${req.branch} into ${base}.`, summary);
    return { ok: true, message: review.decision!.message, review };
  }

  private async sendBack(req: FinishRequest, data: ReviewData, state: ReviewState, summary: ReviewState['summary']): Promise<FinishResult> {
    const session = data.session;
    if (!session) throw new Error('No Claude Code session is linked to this branch, so there is nothing to resume.');
    if (!existsSync(session.cwd)) throw new Error(`The session ran in ${session.cwd}, which no longer exists.`);
    if (!state.comments.length && !req.dropStepKeys.length && !req.note.trim()) throw new Error('Add a comment, a note, or a step to drop first.');

    const env = { ...(await shellEnv()) };
    // Sessions from another config dir (~/.claude-work, ...) only resume with that dir set.
    if (session.configDir && session.configDir !== DEFAULT_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = session.configDir;
    else delete env.CLAUDE_CONFIG_DIR;
    const claude = await which('claude', env);
    if (!claude) throw new Error('Could not find the "claude" command. Is Claude Code installed?');
    const wtv = (await which('wtv', env)) ? 'wtv' : `node ${this.wtvBin}`;
    const prompt = sendBackPrompt(data, state, req, `${wtv} verify`);

    mkdirSync(this.logDir, { recursive: true });
    const logFile = join(this.logDir, `${session.id}-${Date.now()}.jsonl`);
    const fd = openSync(logFile, 'a');
    const args = [
      '--resume', session.id,
      '--print', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      // Edits are allowed so the agent can fix things. Shell access is limited to the verifier and read-only git.
      '--permission-mode', 'acceptEdits',
      '--allowedTools', `Bash(${wtv} *)`, 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)',
    ];
    const child = spawn(claude, args, { cwd: session.cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    child.unref();

    const review = this.record(req, 'sent-back', 'running', `Resumed the Claude Code session with your feedback.`, summary, { logFile, pid: child.pid });
    child.on('exit', (code) => {
      this.store.updateReview(req.projectId, req.branch, (r) => {
        if (!r.decision || r.decision.logFile !== logFile) return;
        r.decision.result = code === 0 ? 'ok' : 'failed';
        r.decision.message = code === 0 ? 'The agent finished working on your feedback.' : `The agent run stopped with exit code ${code}. See the log for details.`;
      });
      this.onChange();
    });
    child.on('error', (e) => {
      this.store.updateReview(req.projectId, req.branch, (r) => {
        if (r.decision?.logFile === logFile) Object.assign(r.decision, { result: 'failed', message: e.message });
      });
      this.onChange();
    });
    return { ok: true, message: review.decision!.message, review };
  }

  private async discard(req: FinishRequest, summary: ReviewState['summary']): Promise<FinishResult> {
    let message = 'Closed this review. Nothing changed in git: the branch and any session are still there.';
    if (req.deleteBranch) {
      const { project, d } = await this.projects.find(req.projectId, req.branch);
      if (d.branch.pr || d.branch.headRef !== req.branch || !(await g.refExists(project.path, `refs/heads/${req.branch}`))) {
        throw new Error(`${req.branch} isn't a local branch, so Reviewer won't delete it. Discard without deleting.`);
      }
      if (d.branch.checkout.kind === 'main') throw new Error(`Your main folder has ${req.branch} checked out, so it can't be deleted. Switch branches first.`);
      if (d.branch.checkout.kind === 'worktree') await g.git(['worktree', 'remove', '--force', d.branch.checkout.path], project.path);
      await g.git(['branch', '-D', req.branch], project.path);
      message = `Discarded. Deleted ${req.branch}${d.branch.checkout.kind === 'worktree' ? ' and its worktree' : ''}. The session stays in your history.`;
    }
    const review = this.record(req, 'discarded', 'ok', message, summary);
    return { ok: true, message, review };
  }
}
