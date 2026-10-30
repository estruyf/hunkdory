import { useEffect, useRef, useState } from 'react';
import type { ReviewData, WalkthroughJob } from '../../shared/types.ts';
import { CircleCheck, Loader2 } from 'lucide-react';
import { cleanError } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';
import { jobKey, useWalkthroughJobFor, useWalkthroughs } from '../state/walkthroughs.ts';

/**
 * Follows Hunkdory writing a walkthrough for one branch. With `auto`, starts it as soon as a branch
 * without a walkthrough opens, if the project allows it; the main process checks that, and runs it once per diff.
 * The run goes on when you leave the branch. `onDone` fires when it finishes while you're here, and when you
 * come back to data read before it finished.
 */
export function useWalkthroughJob(data: ReviewData | undefined, opts: { auto?: boolean; onDone?: () => void } = {}) {
  const [error, setError] = useState<string | null>(null);
  const projectId = data?.projectId;
  const branch = data?.branch;
  const job = useWalkthroughJobFor(projectId, branch);

  useEffect(() => {
    if (!projectId || !branch) return;
    let live = true;
    const first = opts.auto && data?.walkthrough === 'skeleton' ? window.api.writeWalkthrough(projectId, branch, { auto: true }) : window.api.walkthroughJob(projectId, branch);
    first.then((j) => live && remember(j), (e) => live && setError(cleanError(e)));
    return () => {
      live = false;
    };
  }, [projectId, branch]);

  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;
  const before = useRef(job?.status);
  useEffect(() => {
    const was = before.current;
    before.current = job?.status;
    if (job?.status !== 'done' || !onDone.current) return;
    // Finished before this data was read, and the data doesn't have it yet: once per run, so it can't loop.
    const stale = data?.walkthrough === 'skeleton' && !reloaded.has(`${projectId}::${branch}::${job.finishedAt}`);
    if (was !== 'running' && !stale) return;
    reloaded.add(`${projectId}::${branch}::${job.finishedAt}`);
    onDone.current();
  }, [job?.status, job?.finishedAt]);

  const write = async () => {
    setError(null);
    try {
      remember(await window.api.writeWalkthrough(projectId!, branch!));
    } catch (e) {
      setError(cleanError(e));
    }
  };
  const cancel = () => window.api.cancelWalkthrough(projectId!, branch!);
  return { job, error, write, cancel };
}

/** Runs whose result a screen read the branch again for. */
const reloaded = new Set<string>();

function remember(job: WalkthroughJob | null) {
  if (job) useWalkthroughs.setState((s) => ({ jobs: { ...s.jobs, [jobKey(job.projectId, job.branch)]: job } }));
}

/**
 * In a review that opened with one step per file: the walkthrough Hunkdory is writing, and switching to it
 * once it's ready. Keep reading meanwhile; what you mark reviewed carries over.
 */
export function WalkthroughBar({ data, onSwitch }: { data: ReviewData; onSwitch(): void }) {
  const job = useWalkthroughJobFor(data.projectId, data.branch);
  const running = job?.status === 'running';
  useTick(running);
  if (data.walkthrough !== 'skeleton' || !job || (!running && job.status !== 'done')) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b border-link/30 bg-link/8 px-6 py-1.5 text-meta text-text">
      {running ? (
        <>
          <Loader2 size={13} className="shrink-0 animate-spin text-link" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">Hunkdory is writing a walkthrough.</strong> Keep going with one step per file; you can switch when it's ready.{' '}
            <span className="text-muted">
              {job.activity ?? 'Working…'} · {since(job.startedAt)}
            </span>
          </span>
        </>
      ) : (
        <>
          <CircleCheck size={13} className="shrink-0 text-ok" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">The walkthrough is ready.</strong> Steps you already reviewed stay reviewed.
          </span>
          <Button size="sm" variant="primary" onClick={onSwitch}>
            Switch to it
          </Button>
        </>
      )}
    </div>
  );
}

function since(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

/** Ticks once a second while something runs, so elapsed time stays current. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

/** Where the walkthrough on this page came from, and Hunkdory writing one when there is none. */
export function WalkthroughNotice({ data, w }: { data: ReviewData; w: ReturnType<typeof useWalkthroughJob> }) {
  const { job } = w;
  const [sharing, setSharing] = useState<'idle' | 'busy' | string>('idle');
  // Your answer to "may Claude write walkthroughs here?", before the review data catches up.
  const [allowed, setAllowed] = useState(data.writeWalkthroughs);
  const running = job?.status === 'running';
  useTick(running);
  if (data.walkthrough === 'agent') return null;

  if (running) {
    const what = data.walkthrough === 'reviewer' ? 'Rewriting the walkthrough' : 'Hunkdory is writing a walkthrough for this branch';
    return (
      <Notice
        tone="info"
        role="status"
        icon={<Loader2 size={14} className="mt-0.5 animate-spin" aria-hidden />}
        actions={
          <Button size="sm" onClick={w.cancel}>
            Stop
          </Button>
        }
      >
        <strong className="font-semibold">{what}.</strong> {job.attempt > 1 ? 'Covering the changes the first pass missed. ' : ''}
        {data.walkthrough === 'skeleton' ? 'Big changes take a few minutes. You can wait here, or start now with one step per file.' : 'The current one stays until the new one is ready.'}
        <span className="block text-meta text-muted">
          {job.activity ?? 'Working…'} · {since(job.startedAt)}
        </span>
      </Notice>
    );
  }

  const failed = job?.status === 'failed' ? job.error : w.error;
  if (data.walkthrough === 'reviewer') {
    const from = [data.pr ? 'the pull request' : data.prompt ? 'your prompt' : null, 'the commits', 'the code'].filter(Boolean).join(', ');
    const shared = data.sharedWalkthrough;
    const share = async () => {
      setSharing('busy');
      try {
        const { url } = await window.api.shareWalkthrough(data.projectId, data.branch);
        setSharing(url);
      } catch (e) {
        setSharing(`error:${cleanError(e)}`);
      }
    };
    const sharedUrl = sharing.startsWith('https://') ? sharing : shared?.url;
    return (
      <Notice
        tone="neutral"
        actions={
          <>
            {data.pr && (
              <Button size="sm" disabled={sharing === 'busy'} aria-busy={sharing === 'busy'} onClick={share}>
                {sharing === 'busy' ? 'Sharing…' : shared || sharing.startsWith('https://') ? 'Share again' : `Share on PR #${data.pr.number}`}
              </Button>
            )}
            <Button size="sm" onClick={w.write}>
              Rewrite
            </Button>
          </>
        }
      >
        <strong className="font-semibold text-text">Hunkdory wrote this walkthrough</strong> from {from}
        {shared && !sharing.startsWith('https://') ? <>, and {shared.by} shared it on the PR</> : null}. The reasons are its reading of the change, not the author's own.
        {sharedUrl && (
          <>
            {' '}
            <button type="button" className="text-link hover:underline" onClick={() => window.api.openExternal(sharedUrl)}>
              See it on the PR ↗
            </button>
          </>
        )}
        {sharing.startsWith('error:') && <span className="text-error"> Sharing failed: {sharing.slice(6)}</span>}
        {failed && <span className="text-error"> Rewriting failed: {failed}</span>}
      </Notice>
    );
  }

  if (allowed === null && !job) {
    const answer = async (on: boolean) => {
      setAllowed(on);
      await window.api.setWriteWalkthroughs(data.projectId, on);
      if (on) w.write();
    };
    return (
      <Notice
        tone="info"
        actions={
          <>
            <Button size="sm" onClick={() => answer(true)}>
              Yes, for this project
            </Button>
            <Button size="sm" onClick={() => answer(false)}>
              Only when I ask
            </Button>
          </>
        }
      >
        <strong className="font-semibold">No walkthrough on this branch.</strong> The steps are one per file, without reasons. Claude Code can write one: it reads the diff, the commits and the agent session, and like any Claude Code
        run that goes to Anthropic. Should Hunkdory do that for every branch in {data.projectName} that opens without one? You can change this in the project's settings.
      </Notice>
    );
  }

  return (
    <Notice
      tone="caution"
      actions={
        <Button size="sm" onClick={w.write}>
          {failed ? 'Try again' : 'Write one'}
        </Button>
      }
    >
      <strong className="font-semibold">No walkthrough on this branch.</strong> The steps are one per file, without reasons.{' '}
      {failed ? <>Hunkdory couldn't write one: {failed}</> : job?.status === 'cancelled' ? 'You stopped Hunkdory writing one.' : ''}
    </Notice>
  );
}
