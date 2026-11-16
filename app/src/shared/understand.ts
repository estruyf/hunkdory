// The pages a review opens with, about the change as a whole: what reviewers said, what was asked, how it fits
// together, and what behaves differently. Only the ones with something on them. Pure, so it can be tested.
import { openThreads, placeThreads } from './threads.ts';
import type { GitHubFeedback, PrReview, ReviewData } from './types.ts';

export type UnderstandPageId = 'reviews' | 'asked' | 'fits' | 'try';

export interface UnderstandPage {
  id: UnderstandPageId;
  /** In the progress bar, the Context panel and "Next: …". */
  label: string;
  /** The page's heading. */
  title: string;
}

type PageData = Pick<ReviewData, 'steps' | 'requested' | 'diagram' | 'background' | 'tryIt' | 'prompt'>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "alice", "alice and bob", "alice, bob and 2 more". */
export const names = (list: string[], shown = 2) => {
  if (list.length <= 1) return list.join('');
  const named = list.length > shown ? list.slice(0, shown) : list.slice(0, -1);
  return `${named.join(', ')} and ${list.length > shown ? `${list.length - shown} more` : list.at(-1)}`;
};

/** The pages with something on them, in reading order. */
export function understandPages(data: PageData, feedback: GitHubFeedback | null): UnderstandPage[] {
  const changes = data.steps.some((s) => s.behaviour);
  const asked = data.prompt ? 'What you asked, and what it did' : 'What was asked, and what it did';
  const tryIt = changes && data.tryIt.length ? 'What behaves differently, and how to try it' : changes ? 'What behaves differently' : 'How to try it';
  return [
    ...(feedback && (feedback.reviews.length || feedback.threads.length) ? [{ id: 'reviews' as const, label: 'What reviewers said', title: 'What reviewers said' }] : []),
    ...(data.requested.length || data.steps.some((s) => s.outsideTask) ? [{ id: 'asked' as const, label: asked, title: asked }] : []),
    ...(data.diagram || data.background ? [{ id: 'fits' as const, label: 'How it fits together', title: 'How it fits together' }] : []),
    ...(changes || data.tryIt.length ? [{ id: 'try' as const, label: changes ? 'What behaves differently' : 'How to try it', title: tryIt }] : []),
  ];
}

/** Where the PR stands with its reviewers, from each one's latest review. */
export function reviewVerdict(reviews: PrReview[]): { tone: 'caution' | 'ok' | 'muted'; text: string } {
  const by = (state: PrReview['state']) => reviews.filter((r) => r.state === state).map((r) => r.login);
  const changes = by('CHANGES_REQUESTED');
  const approved = by('APPROVED');
  const commented = by('COMMENTED');
  if (changes.length) return { tone: 'caution', text: `Changes requested by ${names(changes)}` };
  if (approved.length) return { tone: 'ok', text: `Approved by ${names(approved)}` };
  if (commented.length) return { tone: 'muted', text: `Comments from ${names(commented)}` };
  return { tone: 'muted', text: 'No reviews yet' };
}

/** Open threads, and how many of them sit on a line of this diff. */
export function threadCounts(feedback: GitHubFeedback | null, hunks: ReviewData['hunks']) {
  const open = openThreads(feedback?.threads ?? []);
  const { byHunk } = placeThreads(open, hunks);
  const onLine = [...byHunk.values()].reduce((n, list) => n + list.length, 0);
  return { open: open.length, onLine, elsewhere: open.length - onLine };
}

/** The sentence under "What reviewers said". */
export function reviewsSummary(feedback: GitHubFeedback, hunks: ReviewData['hunks']): string {
  const count = (state: string) => feedback.reviews.filter((r) => r.state === state).length;
  const changes = count('CHANGES_REQUESTED');
  const approved = count('APPROVED');
  const said = changes
    ? `${plural(changes, 'review')} ${changes === 1 ? 'asks' : 'ask'} for changes.`
    : approved
      ? `${plural(approved, 'review')} ${approved === 1 ? 'approves' : 'approve'} it.`
      : feedback.reviews.length
        ? `${plural(feedback.reviews.length, 'review')}, none asking for changes.`
        : 'No reviews yet, only comments.';
  const { open, onLine, elsewhere } = threadCounts(feedback, hunks);
  const are = open === 1 ? 'is' : 'are';
  const threads = !feedback.threads.length
    ? ''
    : !open
      ? 'Every thread is resolved.'
      : !elsewhere
        ? `${plural(open, 'thread')} ${are} open, all on lines in this review.`
        : !onLine
          ? `${plural(open, 'thread')} ${are} open, none on a line in this review.`
          : `${plural(open, 'thread')} ${are} open: ${onLine} on lines in this review, ${elsewhere} not.`;
  return [said, threads].filter(Boolean).join(' ');
}

/** The sentence under "What you asked, and what it did". */
export function askedSummary(data: PageData): string {
  const n = data.requested.length;
  const of = (status: string) => data.requested.filter((r) => r.status === status).length;
  const done = of('done');
  const partly = of('partly');
  const missing = of('missing');
  const files = new Set(data.steps.filter((s) => s.outsideTask).flatMap((s) => s.files)).size;
  const parts = [
    n === 1 ? (done ? 'The one ask has code.' : partly ? 'The one ask is only partly there.' : 'The walkthrough found no code for the one ask.') : n ? `${done} of ${n} asks have code.` : '',
    n > 1 && partly ? `${partly === 1 ? 'One is' : `${partly} are`} only partly there.` : '',
    n > 1 && missing ? `The walkthrough found no code for ${missing === 1 ? 'one' : missing}.` : '',
    files ? `It also changed ${plural(files, 'file')} ${data.prompt ? 'you didn’t ask about' : 'the request doesn’t mention'}.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** The sentence under "What behaves differently, and how to try it". */
export function trySummary(data: PageData): string {
  const changes = data.steps.filter((s) => s.behaviour).length;
  const tries = data.tryIt.length;
  return [
    changes ? `${plural(changes, 'step')} ${changes === 1 ? 'changes' : 'change'} how it behaves.` : '',
    tries ? `${changes ? 'Then t' : 'T'}ry it in ${plural(tries, 'step')} to see it working.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
