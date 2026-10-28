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

export const RISK_LABEL = { high: 'High risk', medium: 'Look closer', low: 'Low risk' } as const;

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
