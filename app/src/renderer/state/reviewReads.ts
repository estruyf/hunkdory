// The last read of each review, to show at once when you come back to it. Reading a branch asks GitHub
// for its open PRs once the last answer is a minute old, which takes seconds on a busy repo.
import type { ReviewData, ReviewState } from '../../shared/types.ts';
import { jobKey, useWalkthroughs } from './walkthroughs.ts';

export interface ReviewRead {
  data: ReviewData;
  state: ReviewState;
}

/** A read holds the whole diff, and the app stays open for days. */
const KEEP = 10;
const reads = new Map<string, ReviewRead>();

/** Reads the branch, and remembers it for next time. */
export async function readReview(projectId: string, branch: string): Promise<ReviewRead> {
  const read = await window.api.loadReview(projectId, branch);
  const key = jobKey(projectId, branch);
  reads.delete(key);
  reads.set(key, read);
  if (reads.size > KEEP) reads.delete(reads.keys().next().value!);
  return read;
}

/** Your reviewed steps and comments move on between reads. */
export function rememberReadState(state: ReviewState) {
  const key = jobKey(state.projectId, state.branch);
  const read = reads.get(key);
  if (read) reads.set(key, { ...read, state });
}

/** The last read, if there's one worth showing. Show it until a new read is in: the branch may have moved on. */
export function lastRead(projectId: string, branch: string): ReviewRead | null {
  const key = jobKey(projectId, branch);
  const read = reads.get(key);
  // A walkthrough finished since: rather wait for it than show one step per file.
  if (read?.data.walkthrough === 'skeleton' && useWalkthroughs.getState().jobs[key]?.status === 'done') return null;
  return read ?? null;
}
