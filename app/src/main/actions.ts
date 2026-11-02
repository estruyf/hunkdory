// Finishing a review: merge locally, send back to the agent, or discard.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as g from './git.ts';
import * as gh from './github.ts';
import type { Projects } from './projects.ts';
import type { Store } from './store.ts';
import { which, shellEnv } from './shellEnv.ts';
import { assistantFor } from './assistants/index.ts';
import { reviewedNote } from '../shared/comments.ts';
import type { Comment, DecisionRecord, FinishRequest, FinishResult, HunkView, ReviewData, ReviewState, Step } from '../shared/types.ts';

const where = (c: Comment) => (c.path && c.line ? ` at ${c.path}:${c.line}${c.side === 'LEFT' ? ' (removed line)' : ''}` : '');

/** The message a resumed agent session gets. Plain text, one item per comment. */
export function sendBackPrompt(data: Pick<ReviewData, 'steps'>, state: Pick<ReviewState, 'comments'>, req: Pick<FinishRequest, 'note' | 'dropStepKeys'>, wtvCommand: string): string {
  const stepOf = (key: string) => data.steps.find((s) => s.key === key);
  const label = (s: Step | undefined) => (s ? `Step ${s.index + 1} "${s.title}" (${s.files.join(', ') || 'no files'})` : 'A step that no longer exists');
  const lines = ['I reviewed your changes on this branch in Hunkdory. Please address the feedback below.', ''];
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

/** Longest range a step comment covers on GitHub: enough to show where it is without quoting a whole new file. */
const MAX_SPAN = 30;

/**
 * Where a step comment goes on GitHub: the step's first block of changes, from its first changed line,
 * the way review bots comment on a range. Added lines when it has them, else the removed ones. Pure.
 */
export function stepAnchor(step: Step, hunks: Record<string, HunkView>): Omit<gh.LineComment, 'body'> | null {
  for (const id of step.hunkIds) {
    const h = hunks[id];
    if (!h || h.synthetic || h.untracked) continue;
    const added = h.lines.flatMap((l) => (l.kind === 'add' && l.newN ? [l.newN] : []));
    const side = added.length ? 'RIGHT' : 'LEFT';
    const ns = added.length ? added : h.lines.flatMap((l) => (l.kind === 'del' && l.oldN ? [l.oldN] : []));
    if (!ns.length) continue;
    const first = Math.min(...ns);
    const last = Math.min(Math.max(...ns), first + MAX_SPAN - 1);
    return { path: h.path, line: last, side, ...(first < last ? { startLine: first, startSide: side } : {}) };
  }
  return null;
}

/**
 * Your review as a GitHub review: line comments on their lines, step comments on the step's first changed lines,
 * the note in the text. With `inline` false (the PR moved on, or you reviewed uncommitted work) they all go into the text. Pure.
 */
export function githubReview(
  data: Pick<ReviewData, 'steps'> & Partial<Pick<ReviewData, 'hunks'>>,
  state: Pick<ReviewState, 'comments'>,
  req: Pick<FinishRequest, 'note' | 'dropStepKeys'>,
  opts: { inline: boolean; copilot: boolean; reviewer?: string | null }
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
      const at = opts.inline && s && data.hunks ? stepAnchor(s, data.hunks) : null;
      if (at) {
        // The comment sits on one file; name the step's others so it still reads as about the whole step.
        const others = s!.files.filter((f) => f !== at.path);
        inline.push({ ...at, body: `**${label(s)}**${others.length ? ` (also ${others.map((f) => `\`${f}\``).join(', ')})` : ''}\n\n${c.body.trim()}` });
        continue;
      }
      folded.push(`**${label(s)}**${s?.files.length ? ` (${s.files.map((f) => `\`${f}\``).join(', ')})` : ''}\n${c.body.trim()}`);
    }
  }
  parts.push(...folded);
  const drops = req.dropStepKeys.map(stepOf).filter((s): s is Step => !!s);
  if (drops.length) parts.push(['Please drop these changes, they are outside the task:', ...drops.map((s) => `- ${label(s)} (${s.files.map((f) => `\`${f}\``).join(', ')})`)].join('\n'));
  // Nothing to say: one line that you reviewed it, rather than a review that's only the footer.
  if (!parts.length && !inline.length) return { body: reviewedNote(opts.reviewer ?? null), comments: [] };
  parts.push('<sub>Reviewed step by step with Hunkdory.</sub>');
  return { body: parts.join('\n\n'), comments: inline };
}

/** The description of a pull request Hunkdory opens for a branch you approved. Pure. */
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
  parts.push('<sub>Reviewed step by step with Hunkdory.</sub>');
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
      if (req.kind === 'merge' && data.uncommitted) return await this.commit(req, data, summary);
      if (req.kind === 'merge' && req.openPr) return await this.openPr(req, data, state, summary);
      if (req.kind === 'merge') return await this.merge(req, data, summary);
      if (req.kind === 'github') return await this.postReview(req, data, state, summary);
      // A Copilot session on this Mac is resumed directly; only a GitHub coding-agent PR (no local session) goes through a review comment.
      if (req.kind === 'send-back' && data.agent === 'copilot' && !data.session) return await this.postReview({ ...req, event: 'REQUEST_CHANGES' }, data, state, summary, true);
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
    // A comment or an approval without anything to say still says you reviewed it; asking for changes has to say which.
    if (event === 'REQUEST_CHANGES' && !comments.length && !req.note.trim() && !req.dropStepKeys.length) throw new Error('Say what needs to change: add a comment or a review summary.');
    // Line numbers only fit GitHub's diff when you reviewed exactly the PR's head.
    const inline = data.headSha === pr.headRefOid && !data.dirty;
    const review = githubReview(data, state, req, { inline, copilot: toCopilot, reviewer: data.githubLogin });
    const posted = await gh.postReview(project.path, repo, pr.number, { commitId: pr.headRefOid, body: review.body, event, comments: review.comments }).catch((e) => {
      if (event === 'APPROVE' && gh.isOwnPrError(e)) throw new Error(`GitHub doesn’t let you approve your own PR. Post your review as a comment, or approve and merge it without an approval.`);
      throw e;
    });
    const how = event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Requested changes on' : 'Commented on';
    const moved = review.comments.length && !posted.inline ? ' GitHub couldn’t place your comments on the code, so they are in the review text.' : !inline && comments.length ? ' The PR differs from what you reviewed, so your comments are in the review text.' : '';
    const message = toCopilot ? `Posted your review on PR #${pr.number} for Copilot. It picks it up on GitHub and pushes new commits.${moved}` : `${how} PR #${pr.number} on GitHub.${moved}`;
    const r = this.record(req, toCopilot ? 'sent-back' : 'reviewed', 'ok', message, summary, { github: { event, url: posted.url, prUrl: pr.url } });
    return { ok: true, message, review: r };
  }

  /** Approves the pull request on GitHub, with your comments, then merges it there. */
  private async mergePr(req: FinishRequest, data: ReviewData, state: ReviewState, summary: ReviewState['summary']): Promise<FinishResult> {
    const { project, pr, repo } = await this.projects.pullRequest(req.projectId, req.branch);
    if (data.headSha !== pr.headRefOid) throw new Error(`PR #${pr.number} changed since you opened this review. Reload it and look at what's new first.`);
    const comments = state.comments.filter((c) => c.body.trim());
    const review = githubReview(data, state, { ...req, dropStepKeys: [] }, { inline: !data.dirty, copilot: false, reviewer: data.githubLogin });
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
    const r = this.record(req, 'merged', 'ok', message, summary, { github: { event: approved ? 'APPROVE' : 'COMMENT', url, prUrl: pr.url } });
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
    const r = this.record(req, 'reviewed', 'ok', message, summary, { github: { event: 'APPROVE', url: pr.url, prUrl: pr.url } });
    return { ok: true, message, review: r };
  }

  /** Uncommitted work in the branch's worktree: ask first, or commit it when you said so. */
  private async commitFirst(req: FinishRequest, d: Awaited<ReturnType<Projects['find']>>['d'], data: ReviewData): Promise<FinishResult | null> {
    if (d.branch.checkout.kind !== 'worktree' || !d.branch.dirtyFiles) return null;
    if (!req.commitFirst) return { ok: false, needsCommit: d.branch.dirtyFiles, message: `${d.branch.dirtyFiles} file(s) on this branch aren't committed yet.` };
    const wt = d.branch.checkout.path;
    await g.git(['add', '-A', '--', '.', ':(exclude).review'], wt);
    await g.git(['commit', '-m', data.title, '-m', 'Committed by Hunkdory before finishing the review.'], wt);
    return null;
  }

  /** Uncommitted work on a base branch has nothing to merge: approving it commits it where it is. */
  private async commit(req: FinishRequest, data: ReviewData, summary: ReviewState['summary']): Promise<FinishResult> {
    const { d } = await this.projects.find(req.projectId, req.branch);
    if (d.branch.checkout.kind === 'none') throw new Error(`${req.branch} isn't checked out on this Mac anymore.`);
    const path = d.branch.checkout.path;
    if ((await g.currentBranch(path)) !== req.branch) throw new Error(`The folder with these changes is no longer on ${req.branch}. Reload the review.`);
    await g.git(['add', '-A', '--', '.', ':(exclude).review'], path);
    await g.git(['commit', '-m', req.commitMessage?.trim() || data.title, '-m', 'Reviewed with Hunkdory.'], path);
    const sha = (await g.git(['rev-parse', '--short', 'HEAD'], path)).trim();
    const message = `Committed ${d.branch.dirtyFiles} file${d.branch.dirtyFiles === 1 ? '' : 's'} to ${req.branch} as ${sha}. Nothing was pushed.`;
    const review = this.record(req, 'merged', 'ok', message, summary, { commit: sha });
    return { ok: true, message, review };
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
      await g.git(['commit', '-m', data.title, '-m', 'Committed by Hunkdory before merging.'], wt);
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
    if (!data.assistant) throw new Error("This project is set to Manual, so there's no assistant to send this back to.");
    const session = data.session;
    if (!session) throw new Error('No session is linked to this branch, so there is nothing to resume.');
    if (!existsSync(session.cwd)) throw new Error(`The session ran in ${session.cwd}, which no longer exists.`);
    if (!state.comments.length && !req.dropStepKeys.length && !req.note.trim()) throw new Error('Add a comment, a note, or a step to drop first.');

    // The session's own CLI handles it, whatever the project is set to today.
    const assistant = assistantFor({ assistant: session.agent });
    const env = { ...(await shellEnv()) };
    const wtv = (await which('wtv', env)) ? 'wtv' : `node ${this.wtvBin}`;
    const prompt = sendBackPrompt(data, state, req, `${wtv} verify`);

    mkdirSync(this.logDir, { recursive: true });
    const logFile = join(this.logDir, `${session.id}-${Date.now()}.jsonl`);
    const { pid } = await assistant.sendBack({
      session: { id: session.id, cwd: session.cwd, configDir: session.configDir },
      prompt,
      logFile,
      allowBash: [assistant.id === 'copilot' ? `shell(${wtv} *)` : `Bash(${wtv} *)`],
      onExit: (ok, message) => {
        this.store.updateReview(req.projectId, req.branch, (r) => {
          if (!r.decision || r.decision.logFile !== logFile) return;
          r.decision.result = ok ? 'ok' : 'failed';
          r.decision.message = message;
        });
        this.onChange();
      },
    });

    const review = this.record(req, 'sent-back', 'running', `Resumed the ${assistant.name} session with your feedback.`, summary, { logFile, pid });
    return { ok: true, message: review.decision!.message, review };
  }

  private async discard(req: FinishRequest, summary: ReviewState['summary']): Promise<FinishResult> {
    let message = 'Closed this review. Nothing changed in git: the branch and any session are still there.';
    if (req.deleteBranch) {
      const { project, d } = await this.projects.find(req.projectId, req.branch);
      if (d.branch.pr || d.branch.uncommitted || d.branch.headRef !== req.branch || !(await g.refExists(project.path, `refs/heads/${req.branch}`))) {
        throw new Error(`${req.branch} isn't a local branch, so Hunkdory won't delete it. Discard without deleting.`);
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
