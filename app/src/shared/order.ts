import type { ReviewOrder, Step } from './types.ts';

const RANK = { high: 3, medium: 2, low: 1 } as const;

/** Story order is the agent's; the other two help when you're short on time or think in files. */
export function orderSteps(steps: Step[], order: ReviewOrder): Step[] {
  const list = [...steps];
  if (order === 'risk') {
    return list.sort(
      (a, b) =>
        Number(a.source === 'skipped') - Number(b.source === 'skipped') ||
        RANK[b.risk] - RANK[a.risk] ||
        Number(b.outsideTask) - Number(a.outsideTask) ||
        a.index - b.index
    );
  }
  if (order === 'file') {
    return list.sort((a, b) => (a.files[0] ?? '').localeCompare(b.files[0] ?? '') || a.index - b.index);
  }
  return list.sort((a, b) => a.index - b.index);
}

/** A step counts as reviewed only while its hunks are the ones you looked at. */
export function isReviewed(step: Step, reviewed: Record<string, string[]>): boolean {
  const seen = reviewed[step.key];
  if (!seen || seen.length !== step.hunkIds.length) return false;
  const set = new Set(seen);
  return step.hunkIds.every((id) => set.has(id));
}

/**
 * Your reviewed marks after the steps changed shape, e.g. a walkthrough replaced one step per file: a step
 * whose every hunk you already reviewed counts as reviewed. A mark for a step that is gone stays while some
 * of its hunks aren't in a reviewed step yet, so nothing you looked at is forgotten. Null when nothing changes.
 */
export function carryReviewed(steps: Pick<Step, 'key' | 'hunkIds'>[], reviewed: Record<string, string[]>): Record<string, string[]> | null {
  const seen = new Set(Object.values(reviewed).flat());
  const next = { ...reviewed };
  let changed = false;
  for (const step of steps) {
    if (!step.hunkIds.length || isReviewed(step as Step, next) || !step.hunkIds.every((id) => seen.has(id))) continue;
    next[step.key] = [...step.hunkIds];
    changed = true;
  }
  const keys = new Set(steps.map((s) => s.key));
  const covered = new Set(steps.filter((s) => isReviewed(s as Step, next)).flatMap((s) => s.hunkIds));
  for (const [key, ids] of Object.entries(next)) {
    if (keys.has(key) || !ids.every((id) => covered.has(id))) continue;
    delete next[key];
    changed = true;
  }
  return changed ? next : null;
}

/** One scale everywhere: risk pills, decision cards and the inbox. */
export const RISK_LABEL = { high: 'Needs attention', medium: 'Worth a look', low: 'Low risk' } as const;

/** What "outside your request" means, for a hint on the label. */
export const OUTSIDE_HINT = 'Your prompt or the PR description didn’t ask for this change. Keep it, or have it dropped when you finish.';

export function delta(added: number, removed: number): string {
  const parts = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`−${removed}`);
  return parts.join(' ') || '±0';
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'Yesterday';
  if (s < 7 * 86400) return new Date(iso).toLocaleDateString('en', { weekday: 'short' });
  return new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short' });
}

/** "19 min", "4 h": a rough review time you can take in at a glance. Callers say "about". */
export function formatDuration(min: number): string {
  return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
}

/** More than one sitting can take in: better split, or reviewed over several sittings. */
export const tooBig = (w: { minutes: number; steps: number }) => w.minutes > 120 || w.steps > 60;

/**
 * The inbox in the order to pick it up: reviews you started, then ones updated since your review,
 * then the rest by size (failing CI after passing), with changes too big for one sitting last.
 */
export function suggestedOrder<T extends { minutes: number; steps: number; updatedSinceReview: boolean; updatedAt: string | null; review: { status: string; reviewedSteps: number } | null; checks: { state: string }[] }>(items: T[]): T[] {
  const group = (w: T) => (w.review?.status === 'open' && w.review.reviewedSteps > 0 ? 0 : w.updatedSinceReview ? 1 : tooBig(w) ? 3 : 2);
  const failing = (w: T) => Number(w.checks.some((c) => c.state === 'fail'));
  return [...items].sort((a, b) => group(a) - group(b) || failing(a) - failing(b) || a.minutes - b.minutes || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}
