import { useEffect, useState } from 'react';
import type { ReviewData, WalkthroughJob } from '../../shared/types.ts';
import { cleanError } from './ui.tsx';

/**
 * Follows Reviewer writing a walkthrough for one branch. With `auto`, starts it as soon as a branch
 * without a walkthrough opens; the main process makes sure that happens once per diff.
 */
export function useWalkthroughJob(data: ReviewData | undefined, opts: { auto?: boolean; onDone?: () => void } = {}) {
  const [job, setJob] = useState<WalkthroughJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = data?.projectId;
  const branch = data?.branch;

  useEffect(() => {
    if (!projectId || !branch) return;
    let live = true;
    const off = window.events.onWalkthroughChanged((j) => {
      if (j.projectId !== projectId || j.branch !== branch) return;
      setJob(j);
      if (j.status === 'done') opts.onDone?.();
    });
    const first = opts.auto && data?.walkthrough === 'skeleton' ? window.api.writeWalkthrough(projectId, branch, { auto: true }) : window.api.walkthroughJob(projectId, branch);
    first.then((j) => live && setJob(j), (e) => live && setError(cleanError(e)));
    return () => {
      live = false;
      off();
    };
  }, [projectId, branch]);

  const write = async () => {
    setError(null);
    try {
      setJob(await window.api.writeWalkthrough(projectId!, branch!));
    } catch (e) {
      setError(cleanError(e));
    }
  };
  const cancel = () => window.api.cancelWalkthrough(projectId!, branch!);
  return { job, error, write, cancel };
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

/** Where the walkthrough on this page came from, and Reviewer writing one when there is none. */
export function WalkthroughNotice({ data, w }: { data: ReviewData; w: ReturnType<typeof useWalkthroughJob> }) {
  const { job } = w;
  const [sharing, setSharing] = useState<'idle' | 'busy' | string>('idle');
  const running = job?.status === 'running';
  useTick(running);
  if (data.walkthrough === 'agent') return null;

  const action = (label: string, fn: () => void) => (
    <button type="button" className="link" style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }} onClick={fn}>
      {label}
    </button>
  );
  const row = (cls: string, body: React.ReactNode, act: React.ReactNode) => (
    <div className={cls} role="status" aria-live="polite" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{body}</span>
      {act}
    </div>
  );

  if (running) {
    const what = data.walkthrough === 'reviewer' ? 'Rewriting the walkthrough' : 'Reviewer is writing a walkthrough for this branch';
    return row(
      'notice info',
      <>
        <span className="spinner" style={{ marginTop: 3, flex: 'none' }} />
        <span>
          <strong>{what}.</strong> {job.attempt > 1 ? 'Covering the changes the first pass missed. ' : ''}
          {data.walkthrough === 'skeleton' ? 'Big changes take a few minutes. You can wait here, or start now with one step per file.' : 'The current one stays until the new one is ready.'}
          <br />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {job.activity ?? 'Working…'} · {since(job.startedAt)}
          </span>
        </span>
      </>,
      action('Stop', w.cancel)
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
    return row(
      'notice info',
      <span>
        <strong>Reviewer wrote this walkthrough</strong> from {from}
        {shared && !sharing.startsWith('https://') ? <>, and {shared.by} shared it on the PR</> : null}. The reasons are its reading of the change, not the author's own.
        {sharedUrl && (
          <>
            {' '}
            <button type="button" className="link" style={{ fontSize: 13.5 }} onClick={() => window.api.openExternal(sharedUrl)}>
              See it on the PR ↗
            </button>
          </>
        )}
        {sharing.startsWith('error:') && <span className="error"> Sharing failed: {sharing.slice(6)}</span>}
        {failed && <span className="error"> Rewriting failed: {failed}</span>}
      </span>,
      <span style={{ display: 'flex', gap: 14 }}>
        {data.pr && action(sharing === 'busy' ? 'Sharing…' : shared || sharing.startsWith('https://') ? 'Share again' : `Share on PR #${data.pr.number}`, share)}
        {action('Rewrite', w.write)}
      </span>
    );
  }

  return row(
    'notice',
    <span>
      <strong>No walkthrough on this branch.</strong> The steps below are one per file, without reasons.{' '}
      {failed ? <>Reviewer couldn't write one: {failed}</> : job?.status === 'cancelled' ? 'You stopped Reviewer writing one.' : ''}
    </span>,
    action(failed ? 'Try again' : 'Write one', w.write)
  );
}
