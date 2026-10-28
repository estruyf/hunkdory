// What changed since your last pass over a branch. Hunk ids are content hashes, so a hunk with the
// same id is the exact change you saw before. Pure.
import type { Comment, DecisionRecord, ReviewState, Step } from './types.ts';

/** `same`: every change in the step was there last time. `changed`: some were. `new`: none were. */
export type StepChange = 'new' | 'changed' | 'same';

export interface SinceLast {
  decision: DecisionRecord;
  byStep: Record<string, StepChange>;
  /** Hunks that were part of the branch last time. */
  before: Set<string>;
  /** Hunks you marked reviewed in any earlier round. */
  reviewedBefore: Set<string>;
  /** Steps whose every change you already reviewed: safe to skip. */
  alreadyReviewed: Step[];
  /** Changes from last time that are no longer in the branch: reverted, or rewritten. */
  gone: number;
  /** What you said last round, per step, so you can check the agent's answer to it. */
  earlierComments: Record<string, Comment[]>;
}

export function sinceLastRound(steps: Step[], state: Pick<ReviewState, 'rounds'>): SinceLast | null {
  const rounds = state.rounds ?? [];
  const last = rounds.at(-1);
  if (!last) return null;
  const reviewedBefore = new Set(rounds.flatMap((r) => Object.values(r.reviewed).flat()));
  // Older decisions didn't keep every hunk; what you reviewed is the best we have then.
  const before = new Set(last.decision.hunkIds ?? Object.values(last.reviewed).flat());
  const now = new Set(steps.flatMap((s) => s.hunkIds));

  const byStep: Record<string, StepChange> = {};
  for (const s of steps) {
    const known = s.hunkIds.filter((id) => before.has(id)).length;
    byStep[s.key] = known === 0 ? 'new' : known === s.hunkIds.length ? 'same' : 'changed';
  }
  const earlierComments: Record<string, Comment[]> = {};
  for (const c of last.comments.filter((c) => c.body.trim())) (earlierComments[c.stepKey] ??= []).push(c);

  return {
    decision: last.decision,
    byStep,
    before,
    reviewedBefore,
    alreadyReviewed: steps.filter((s) => s.hunkIds.length > 0 && s.hunkIds.every((id) => reviewedBefore.has(id))),
    gone: [...before].filter((id) => !now.has(id)).length,
    earlierComments,
  };
}
