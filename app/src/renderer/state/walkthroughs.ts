// Walkthroughs Hunkdory is writing, for every branch, so the sidebar and every screen can follow them.
// The runs live in the main process: leaving a branch doesn't stop its run, and this store keeps up with it.
import { create } from 'zustand';
import type { WalkthroughJob } from '../../shared/types.ts';
import { useNav } from './nav.ts';

export const jobKey = (projectId: string, branch: string) => `${projectId}::${branch}`;

interface WalkthroughsStore {
  jobs: Record<string, WalkthroughJob>;
  /** Finished while you were on another branch, and you haven't opened it since. */
  ready: Record<string, { projectId: string; branch: string }>;
  /** You opened the branch: it isn't news anymore. */
  seen(projectId: string, branch: string): void;
}

export const useWalkthroughs = create<WalkthroughsStore>()((set) => ({
  jobs: {},
  ready: {},
  seen: (projectId, branch) =>
    set((s) => {
      const key = jobKey(projectId, branch);
      if (!s.ready[key]) return s;
      const { [key]: _gone, ...ready } = s.ready;
      return { ready };
    }),
}));

/** The branch on screen, if any. */
function viewing(): string | null {
  const route = useNav.getState().route;
  return route && 'branch' in route ? jobKey(route.projectId, route.branch) : null;
}

/** Starts following the runs: the ones going already, then every change. Once, for the app's lifetime. */
export function watchWalkthroughs(): () => void {
  window.api.walkthroughJobs().then((list) =>
    useWalkthroughs.setState((s) => ({ jobs: { ...Object.fromEntries(list.map((j) => [jobKey(j.projectId, j.branch), j])), ...s.jobs } }))
  );
  return window.events.onWalkthroughChanged((job) => {
    const key = jobKey(job.projectId, job.branch);
    useWalkthroughs.setState((s) => ({
      jobs: { ...s.jobs, [key]: job },
      ready: job.status === 'done' && viewing() !== key ? { ...s.ready, [key]: { projectId: job.projectId, branch: job.branch } } : s.ready,
    }));
  });
}

export const useWalkthroughJobFor = (projectId: string | undefined, branch: string | undefined) =>
  useWalkthroughs((s) => (projectId && branch ? (s.jobs[jobKey(projectId, branch)] ?? null) : null));
