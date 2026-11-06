import { useEffect, useRef, useState } from 'react';
import type { ReviewData, WalkthroughJob } from '../../shared/types.ts';
import { CircleCheck, Loader2 } from 'lucide-react';
import { cleanError, plural } from './ui.tsx';
import { usageNote, whereCodeGoes } from '../../shared/assistantText.ts';
import { tooBig } from '../../shared/order.ts';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';
import { TextButton } from './ui/TextButton.tsx';
import { jobKey, useWalkthroughJobFor, useWalkthroughs } from '../state/walkthroughs.ts';

const PLAIN = 'flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-5 text-ui text-muted';

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
  // Only what the walkthrough doesn't cover yet, such as a change Claude made. Nothing to do: the data is just stale.
  const update = async () => {
    setError(null);
    try {
      const j = await window.api.updateWalkthrough(projectId!, branch!);
      if (j) remember(j);
      else onDone.current?.();
    } catch (e) {
      setError(cleanError(e));
    }
  };
  const cancel = () => window.api.cancelWalkthrough(projectId!, branch!);
  // You answered "may Claude write walkthroughs here?", before the review data catches up.
  const [answered, setAnswered] = useState(false);
  const answer = async (on: boolean) => {
    setAnswered(true);
    await window.api.setWriteWalkthroughs(projectId!, on);
    if (on) write();
  };
  return {
    job,
    error,
    write,
    update,
    cancel,
    answer,
    /** The question hasn't been answered. It says where the code goes, so nothing offers to write one until it has. */
    asking: !!data?.assistant && data.writeWalkthroughs === null && !answered && !job,
    failed: job?.status === 'failed' ? job.error : error,
  };
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
  // A run for another base, as before a rebase, has nothing to switch to: its walkthrough doesn't count here.
  if (data.walkthrough !== 'skeleton' || !job || (!running && (job.status !== 'done' || job.baseSha !== data.baseSha))) return null;
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

/**
 * A step whose refs match nothing: the code it was about changed after the walkthrough was written.
 * Says so instead of an empty diff, and brings Hunkdory's walkthrough up to date. Reloads once that's done.
 */
export function EmptyStepNotice({ data, onReload, onOpenStep }: { data: ReviewData; onReload(): void; onOpenStep(key: string): void }) {
  const w = useWalkthroughJob(data, { onDone: onReload });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = w.job?.status === 'running';
  useTick(running);
  const unnarrated = data.steps.find((s) => s.source === 'unnarrated');
  const where = unnarrated && (
    <>
      {' '}
      The code as it is now is in{' '}
      <button type="button" className="text-link hover:underline" onClick={() => onOpenStep(unnarrated.key)}>
        step {unnarrated.index + 1}
      </button>{' '}
      and the steps after it, under “Not in the walkthrough”.
    </>
  );

  if (running) {
    return (
      <Notice tone="info" role="status" icon={<Loader2 size={14} className="mt-0.5 animate-spin" aria-hidden />}>
        <strong className="font-semibold">Hunkdory is updating the walkthrough.</strong> The code this step was about changed, so it has no changes until the update is done. It
        reloads by itself.
        <span className="block text-meta text-muted">
          {w.job!.activity ?? 'Working…'} · {since(w.job!.startedAt)}
        </span>
      </Notice>
    );
  }

  const update = async () => {
    setStarting(true);
    setError(null);
    try {
      const job = await window.api.updateWalkthrough(data.projectId, data.branch);
      // Nothing to update: the walkthrough already covers the diff, so this screen read the branch too early.
      if (job) remember(job);
      else onReload();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Notice
      tone="caution"
      role="note"
      actions={
        data.walkthrough === 'reviewer' ? (
          <Button size="sm" disabled={starting} aria-busy={starting} onClick={update}>
            {starting ? 'Starting…' : 'Update the walkthrough'}
          </Button>
        ) : undefined
      }
    >
      <strong className="font-semibold">Nothing in the diff matches this step any more.</strong>{' '}
      {data.walkthrough === 'reviewer' ? 'The code it was about changed after Hunkdory wrote the walkthrough.' : 'The code it was about changed after the agent wrote the walkthrough.'}
      {where}
      {(error || (w.job?.status === 'failed' && w.job.error)) && <span className="block text-error">Updating failed: {error ?? w.job!.error}</span>}
    </Notice>
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

/** A branch without a walkthrough, in the plan's "Before you start": why there's none, and Hunkdory writing one. */
export function WalkthroughLine({ data, w }: { data: ReviewData; w: ReturnType<typeof useWalkthroughJob> }) {
  const { job, failed } = w;
  const running = job?.status === 'running';
  useTick(running);
  if (running) {
    return (
      <p role="status" className="m-0">
        <Loader2 size={13} className="mr-1.5 inline-block animate-spin align-[-2px] text-accent-ink" aria-hidden />
        <strong className="font-semibold">Hunkdory is writing a walkthrough.</strong> {job.attempt > 1 ? 'Covering the changes the first pass missed. ' : ''}Big changes take a few minutes. You can wait here, or start now with one step per file. <TextButton onClick={w.cancel}>Stop</TextButton>
        <span className="block text-meta text-muted">
          {job.activity ?? 'Working…'} · {since(job.startedAt)}
        </span>
      </p>
    );
  }
  if (w.asking) {
    return (
      <p className="m-0">
        <strong className="font-semibold">No walkthrough yet</strong>, so the steps are one per file, without reasons. {data.assistant!.name} can write one: it reads the diff, the commits and the agent session. {whereCodeGoes(data.assistant!)} {usageNote(data.assistant!)} Should Hunkdory do that for every branch in {data.projectName} that opens without one? <TextButton onClick={() => w.answer(true)}>Yes, for this project</TextButton> · <TextButton onClick={() => w.answer(false)}>Only when I ask</TextButton>
      </p>
    );
  }
  // Manual projects have no assistant to write a walkthrough with.
  const why = !data.assistant
    ? 'This project is set to Manual, so Hunkdory won’t write one.'
    : failed
      ? `Hunkdory couldn’t write one: ${failed}`
      : job?.status === 'cancelled'
        ? 'You stopped Hunkdory writing one.'
        : data.writeWalkthroughs && tooBig({ minutes: data.minutes, steps: data.steps.length })
          ? 'The branch is big, so Hunkdory didn’t start one on its own.'
          : null;
  return (
    <p className="m-0">
      <strong className="font-semibold">No walkthrough yet</strong>, so the steps are one per file, without reasons. {why}
    </p>
  );
}

/** Where the walkthrough on this page came from, and rewriting it. Nothing for an agent's own, and for a branch without one see `WalkthroughLine`. */
export function WalkthroughNotice({ data, w }: { data: ReviewData; w: ReturnType<typeof useWalkthroughJob> }) {
  const { job, failed } = w;
  const [sharing, setSharing] = useState<'idle' | 'busy' | string>('idle');
  // Posting on the PR is for everyone who can see it: said before it happens.
  const [confirmShare, setConfirmShare] = useState(false);
  const running = job?.status === 'running';
  useTick(running);
  if (data.walkthrough !== 'reviewer') return null;
  // Manual projects have no assistant to rewrite a walkthrough with.
  const manual = !data.assistant;

  if (running) {
    return (
      <section role="status" aria-label="About this walkthrough" className={PLAIN}>
        <span className="min-w-0 flex-[1_1_320px]">
          <Loader2 size={13} className="mr-1.5 inline-block animate-spin align-[-2px] text-accent-ink" aria-hidden />
          <strong className="font-semibold text-text">Rewriting the walkthrough.</strong> {job.attempt > 1 ? 'Covering the changes the first pass missed. ' : ''}The current one stays until the new one is ready.
          <span className="block text-meta">
            {job.activity ?? 'Working…'} · {since(job.startedAt)}
          </span>
        </span>
        <Button size="sm" onClick={w.cancel}>
          Stop
        </Button>
      </section>
    );
  }

  const from = [data.pr ? 'the pull request' : data.prompt ? 'your prompt' : null, 'the commits', 'the code', data.walkthroughFromSession ? 'the agent’s session' : null].filter(Boolean).join(', ');
  const shared = data.sharedWalkthrough;
  const share = async () => {
    setConfirmShare(false);
    setSharing('busy');
    try {
      const { url } = await window.api.shareWalkthrough(data.projectId, data.branch);
      setSharing(url);
    } catch (e) {
      setSharing(`error:${cleanError(e)}`);
    }
  };
  const sharedUrl = sharing.startsWith('https://') ? sharing : shared?.url;
  const uncovered = data.steps.filter((s) => s.source === 'unnarrated');
  return (
    <section aria-label="About this walkthrough" className={PLAIN}>
      <span className="min-w-0 flex-[1_1_320px]">
        <strong className="font-semibold text-text">Hunkdory wrote this walkthrough</strong> from {from}
        {shared && !sharing.startsWith('https://') ? <>, and {shared.by} shared it on the PR</> : null}. The reasons are its reading of the change, not the author’s own.
        {sharedUrl && (
          <>
            {' '}
            <TextButton onClick={() => window.api.openExternal(sharedUrl)}>See it on the PR ↗</TextButton>
          </>
        )}
        {!manual && uncovered.length > 0 && <> {plural(uncovered.length, 'file')} changed since it was written. Updating fits them into its steps.</>}
        {sharing.startsWith('error:') && <span className="text-error"> Sharing failed: {sharing.slice(6)}</span>}
        {failed && <span className="text-error"> Rewriting failed: {failed}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {!manual && uncovered.length > 0 && (
          <Button size="sm" variant="primary" onClick={w.update}>
            Update the walkthrough
          </Button>
        )}
        {data.pr && (
          <Button size="sm" disabled={sharing === 'busy'} aria-busy={sharing === 'busy'} onClick={() => setConfirmShare(true)}>
            {sharing === 'busy' ? 'Sharing…' : shared || sharing.startsWith('https://') ? 'Share again' : `Share on PR #${data.pr.number}`}
          </Button>
        )}
        {!manual && (
          <Button size="sm" data-tooltip={usageNote(data.assistant!)} onClick={w.write}>
            Rewrite
          </Button>
        )}
      </span>
      {confirmShare && (
        <span role="alert" className="flex w-full flex-wrap items-center gap-2 text-text">
          <span className="min-w-0 flex-[1_1_320px]">
            <strong className="font-semibold">Post this on PR #{data.pr!.number}?</strong> Everyone who can see the PR can read it{data.walkthroughFromSession ? ', including what it took from the agent’s session' : ''}. It replaces your earlier one, if you shared before.
          </span>
          <Button size="sm" variant="primary" onClick={share}>
            Post it
          </Button>
          <Button size="sm" onClick={() => setConfirmShare(false)}>
            Cancel
          </Button>
        </span>
      )}
    </section>
  );
}
