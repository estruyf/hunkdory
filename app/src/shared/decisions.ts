// Where a finished review lives on GitHub, if anywhere. Pure.
import type { DecisionRecord } from './types.ts';

/**
 * The review comment when there is one, else the pull request. A merge with no comments posts no review,
 * so its review URL is null. Local merges and discards, and records from before the PR URL was kept, have none.
 */
export function githubLink(decision: Pick<DecisionRecord, 'github'> | null | undefined): string | null {
  const g = decision?.github;
  return g ? (g.url ?? g.prUrl ?? null) : null;
}
