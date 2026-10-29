// The sidebar's groups: what waits for your review first, then what you started, what is with the agent,
// and what you finished or set aside. Pure, so the order can be tested without React.
import { formatDuration, suggestedOrder, tooBig } from '../../../shared/order.ts';
import type { InboxItem, ReviewState } from '../../../shared/types.ts';

export type GroupId = 'review' | 'progress' | 'sent' | 'reviewed' | 'ignored';

export interface BranchRow {
  key: string;
  projectId: string;
  branch: string;
  projectName: string;
  title: string;
  /** One line under the title. */
  meta: string;
  /** The part of the meta line that is a failure (CI failing, a failed run), shown in the error colour. */
  problem: string | null;
  /** When it last changed, short: "2h", "35m". */
  age: string | null;
  /** New, or changed since your review: a bold title. */
  unseen: boolean;
  /** Changed since your review (or since you sent it back): the rail's dot. */
  updated: boolean;
  /** Two letters for the rail's tile, from the title: "Move the page" is MP. */
  initials: string;
  /** Can't be opened (the branch is gone or unreadable). */
  error: string | null;
  /** Ignore takes it out of To review; Bring back puts it back. */
  ignored: boolean;
  /** The agent is working on what you sent back. */
  working: boolean;
  tooltip: string | null;
}

export interface BranchGroup {
  id: GroupId;
  label: string;
  rows: BranchRow[];
  /** Folded by default, with a count. */
  foldable: boolean;
}

/** "now", "35m", "2h", "3d": an age in the sidebar's meta size. */
export function shortAge(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * Two letters that tell branches apart on the rail, from the title without a conventional-commit prefix:
 * "perf(navigation): move the page once" is MP, "Fix flaky worktree tests" is FF. Small words don't count.
 */
const SMALL = new Set(['a', 'an', 'the', 'to', 'of', 'on', 'in', 'for', 'and', 'or', 'with', 'by', 'at', 'from', 'into']);

export function initialsOf(title: string): string {
  const words = title
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .split(/[\s/_-]+/)
    .filter((w) => /^[a-z0-9]/i.test(w) && !SMALL.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join('') || '?';
}

const RESULT = { merged: 'Merged', 'sent-back': 'Sent back', discarded: 'Discarded', reviewed: 'Reviewed on GitHub', open: 'Open' } as const;

const inProgress = (w: InboxItem) => !!w.review && w.review.reviewedSteps > 0 && w.review.status === 'open';

function waitingRow(w: InboxItem, who: string): BranchRow {
  const failing = w.checks.some((c) => c.state === 'fail');
  const started = inProgress(w);
  const left = started ? Math.max(1, Math.round(w.minutes * (1 - w.review!.reviewedSteps / Math.max(1, w.steps)))) : w.minutes;
  const parts = w.error
    ? []
    : started
      ? [`${formatDuration(left)} left`, `step ${w.review!.reviewedSteps} of ${w.steps}`]
      : [w.updatedSinceReview ? 'Updated since your review' : 'New', `about ${formatDuration(left)}${tooBig(w) ? ', too big for one sitting' : ''}`];
  parts.push(w.projectName);
  if (w.pr) parts.push(`PR #${w.pr.number}${w.pr.isDraft ? ' (draft)' : ''}`);
  return {
    key: `${w.projectId}:${w.branch}`,
    projectId: w.projectId,
    branch: w.branch,
    projectName: w.projectName,
    title: w.title,
    meta: parts.join(' · '),
    problem: w.error ? null : failing ? 'CI failing' : null,
    age: shortAge(w.updatedAt),
    unseen: !started && !w.error,
    updated: !started && !w.error && w.updatedSinceReview,
    initials: initialsOf(w.title),
    error: w.error ?? null,
    ignored: w.ignored,
    working: false,
    tooltip: [w.branch, who, w.buildsOn ? `Builds on ${w.buildsOn.pr ? `PR #${w.buildsOn.pr}` : w.buildsOn.branch}` : ''].filter(Boolean).join(' · ') || null,
  };
}

function sentRow(w: InboxItem, state: ReviewState | undefined): BranchRow {
  const running = state?.decision?.result === 'running';
  const failed = state?.decision?.result === 'failed';
  return {
    ...waitingRow(w, ''),
    meta: [running ? `Sent back ${shortAge(state!.decision!.at)} ago, the agent is on it` : w.updatedSinceReview ? 'New commits since you sent it back' : 'Sent back', w.projectName].join(' · '),
    problem: failed ? 'The agent run failed' : null,
    unseen: !running && w.updatedSinceReview,
    updated: !running && w.updatedSinceReview,
    working: running,
  };
}

function doneRow(d: ReviewState, projectName: string): BranchRow {
  return {
    key: d.id,
    projectId: d.projectId,
    branch: d.branch,
    projectName,
    title: d.title,
    meta: `${RESULT[d.status]} · ${projectName}`,
    problem: null,
    age: shortAge(d.decision?.at ?? null),
    unseen: false,
    updated: false,
    initials: initialsOf(d.title),
    error: null,
    ignored: false,
    working: false,
    tooltip: d.branch,
  };
}

export interface RowInput {
  waiting: InboxItem[];
  done: ReviewState[];
  projectNames: Map<string, string>;
  /** Items you can see (project filter, search, People). */
  shown(w: InboxItem): boolean;
  /** Finished reviews you can see. */
  shownDone(d: ReviewState): boolean;
  order: 'suggested' | 'newest';
  who(w: InboxItem): string;
}

export function branchGroups({ waiting, done, projectNames, shown, shownDone, order, who }: RowInput): BranchGroup[] {
  const visible = waiting.filter(shown);
  const active = visible.filter((w) => !w.ignored);
  const sent = active.filter((w) => w.review?.status === 'sent-back');
  const unsent = active.filter((w) => w.review?.status !== 'sent-back');
  const sorted = order === 'suggested' ? suggestedOrder(unsent) : unsent;
  const finished = done.filter((d) => d.decision?.result !== 'running' && shownDone(d));
  return [
    { id: 'review', label: 'To review', rows: sorted.filter((w) => !inProgress(w)).map((w) => waitingRow(w, who(w))), foldable: false },
    { id: 'progress', label: 'In progress', rows: sorted.filter(inProgress).map((w) => waitingRow(w, who(w))), foldable: false },
    { id: 'sent', label: 'Sent back', rows: sent.map((w) => sentRow(w, done.find((d) => d.projectId === w.projectId && d.branch === w.branch))), foldable: false },
    { id: 'reviewed', label: 'Reviewed this week', rows: finished.map((d) => doneRow(d, projectNames.get(d.projectId) ?? '')), foldable: true },
    { id: 'ignored', label: 'Ignored', rows: visible.filter((w) => w.ignored).map((w) => waitingRow(w, who(w))), foldable: true },
  ];
}
