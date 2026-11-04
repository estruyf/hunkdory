// Where GitHub's review threads go in Hunkdory's diff. Pure, so it can be tested.
import type { GitHubThread, HunkView } from './types.ts';

/** The hunk a thread comments on: same file, and its line on the same side of the diff. Null when the code moved on. */
export function threadHunk(t: GitHubThread, hunks: HunkView[]): HunkView | null {
  if (t.line === null) return null;
  return (
    hunks.find((h) => {
      if (t.side === 'LEFT' ? (h.oldPath ?? h.path) !== t.path : h.path !== t.path) return false;
      // A LEFT line is a removed one: unchanged lines take comments on their new side, as the diff shows them.
      return h.lines.some((l) => (t.side === 'LEFT' ? l.kind === 'del' && l.oldN === t.line : l.kind !== 'del' && l.newN === t.line));
    }) ?? null
  );
}

/** Threads by the hunk they sit on, and the ones no hunk shows: outdated, or on code this diff leaves out. */
export function placeThreads(threads: GitHubThread[], hunks: Record<string, HunkView>): { byHunk: Map<string, GitHubThread[]>; elsewhere: GitHubThread[] } {
  const list = Object.values(hunks);
  const byHunk = new Map<string, GitHubThread[]>();
  const elsewhere: GitHubThread[] = [];
  for (const t of threads) {
    const h = threadHunk(t, list);
    if (h) byHunk.set(h.id, [...(byHunk.get(h.id) ?? []), t]);
    else elsewhere.push(t);
  }
  return { byHunk, elsewhere };
}

/** Threads still waiting on someone: not resolved. */
export const openThreads = (threads: GitHubThread[]) => threads.filter((t) => !t.resolved);
