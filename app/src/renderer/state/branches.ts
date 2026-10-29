// The branches in the sidebar's order, for ⌃⇥ and ⌃⇧⇥ and for the closed sidebar's "to review" pill.
import { create } from 'zustand';

export interface BranchRef {
  projectId: string;
  branch: string;
}

interface BranchesStore {
  /** Every branch in the order the sidebar lists them. */
  order: BranchRef[];
  /** How many wait in To review, and the first of them. */
  toReview: number;
  firstToReview: BranchRef | null;
  setOrder(order: BranchRef[], toReview: number, firstToReview: BranchRef | null): void;
}

export const useBranches = create<BranchesStore>()((set) => ({
  order: [],
  toReview: 0,
  firstToReview: null,
  setOrder: (order, toReview, firstToReview) => set({ order, toReview, firstToReview }),
}));

/** The branch after (or before) `current` in the sidebar's order, wrapping around. */
export function stepBranch(order: BranchRef[], current: BranchRef | null, by: 1 | -1): BranchRef | null {
  if (!order.length) return null;
  const at = current ? order.findIndex((b) => b.projectId === current.projectId && b.branch === current.branch) : -1;
  if (at === -1) return by === 1 ? order[0]! : order.at(-1)!;
  return order[(at + by + order.length) % order.length]!;
}
