import type { ReviewState, ReviewerApi, WalkthroughJob } from '../shared/types.ts';

declare global {
  interface Window {
    api: ReviewerApi;
    /** The window frame: which platform draws it, and full screen changes. */
    frame: { platform: string; onFullScreen(fn: (on: boolean) => void): () => void };
    events: {
      onReviewsChanged(fn: () => void): () => void;
      onWalkthroughChanged(fn: (job: WalkthroughJob) => void): () => void;
      /** Clicked "Walkthrough ready": open that branch. */
      onOpenBranch(fn: (to: { projectId: string; branch: string }) => void): () => void;
      onNavigate(fn: (dir: 'back' | 'forward') => void): () => void;
      onReviewStateChanged(fn: (review: ReviewState) => void): () => void;
    };
  }
}
