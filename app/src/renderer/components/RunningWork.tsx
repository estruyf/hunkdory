// What Hunkdory is still doing for a branch, in the top bar: it stays in sight wherever you scroll or read.
import { Loader2 } from 'lucide-react';
import { Elapsed } from './aiReview.tsx';
import { Pill } from './ui/Pill.tsx';
import { useWalkthroughJobFor } from '../state/walkthroughs.ts';
import type { ReviewData, ReviewState } from '../../shared/types.ts';

export type RunningKind = 'walkthrough' | 'ai-review';

/** A pill per run. `onOpen` goes to where you can follow it and stop it. `noWalkthrough` is for a screen that already says one is being written. */
export function RunningWork({ data, state, onOpen, noWalkthrough = false }: { data: ReviewData; state: ReviewState; onOpen: (kind: RunningKind) => void; noWalkthrough?: boolean }) {
  const job = useWalkthroughJobFor(data.projectId, data.branch);
  const review = state.aiReview;
  const runs = [
    ...(job?.status === 'running' && !noWalkthrough ? [{ kind: 'walkthrough' as const, label: data.walkthrough === 'skeleton' ? 'Writing walkthrough' : 'Updating walkthrough', activity: job.activity, startedAt: job.startedAt }] : []),
    ...(review?.status === 'running' ? [{ kind: 'ai-review' as const, label: 'Running AI review', activity: review.activity, startedAt: review.startedAt }] : []),
  ];
  if (!runs.length) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-2">
      {runs.map((r) => (
        <Pill key={r.kind} tone="ok" icon={<Loader2 size={12} className="animate-spin" aria-hidden />} data-tooltip={r.activity ?? 'Working…'} onClick={() => onOpen(r.kind)}>
          {r.label}
          {/* Out of the status: it would be read out every second. */}
          <span aria-hidden>
            · <Elapsed from={r.startedAt} />
          </span>
        </Pill>
      ))}
    </div>
  );
}
