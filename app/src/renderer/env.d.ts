import type { ReviewState, ReviewerApi, WalkthroughJob } from '../shared/types.ts';

declare global {
  interface Window {
    api: ReviewerApi;
    events: {
      onReviewsChanged(fn: () => void): () => void;
      onWalkthroughChanged(fn: (job: WalkthroughJob) => void): () => void;
      onNavigate(fn: (dir: 'back' | 'forward') => void): () => void;
      onReviewStateChanged(fn: (review: ReviewState) => void): () => void;
    };
  }
}
