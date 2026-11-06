import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { STEP_GONE } from '../../shared/assistantText.ts';
import { changeAfterQuestion, changeRequest, noteWasSent } from '../../shared/comments.ts';
import type { Exchange, ReviewData, Step } from '../../shared/types.ts';
import { Markdown } from './markdown.tsx';
import { modKey } from '../lib/shortcuts.ts';
import { Loader2 } from 'lucide-react';
import { cleanError } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { TEXTAREA } from './ui/field.ts';
import { useWalkthroughJobFor } from '../state/walkthroughs.ts';
import { OpenInEditor } from './editor.tsx';

function since(from: string, to: string | null) {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

function who(data: ReviewData, kind: Exchange['kind']): string {
  const a = data.ask;
  const name = data.assistant?.name ?? 'The assistant';
  if (kind === 'question') {
    if (!a.question.by) return (a.question as { reason: string }).reason;
    return a.question.by === 'session-copy' ? 'The agent that wrote this branch answers, from a copy of its session. It can’t change anything.' : `${name} answers from the code. It can’t change anything.`;
  }
  if (!a.change.by) return a.change.reason;
  return a.change.by === 'session' ? `The agent’s own session makes the change, in ${a.change.where}.` : `${name} edits the files in ${a.change.where}. Nothing is committed.`;
}

/** What you just sent, shown until Hunkdory has it on record: reading the branch first can take a few seconds. */
export interface PendingAsk {
  kind: Exchange['kind'];
  text: string;
}

/** Asking the assistant from one step, or from one of its questions. */
function useSend(data: ReviewData, step: Step, check?: number) {
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (kind: Exchange['kind'], text: string) => {
    setPending({ kind, text: text.trim() });
    setError(null);
    try {
      await window.api.ask(data.projectId, data.branch, step.key, kind, text, check);
      return true;
    } catch (e) {
      setError(cleanError(e));
      return false;
    } finally {
      setPending(null);
    }
  };
  return { send, busy: !!pending, pending, error };
}

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

/**
 * Keeps the box where it is on screen while what you asked appears above it. `hold` starts that, and scrolling yourself
 * ends it. So does the end of the run: the answer then pushes the box down, and you read it from its start, where the
 * page already is. `holding` starts it right away, for a box that's built while a run goes on. The page can only move as
 * far as it's long: on a short page the box still moves down.
 */
function useHoldInPlace(running: boolean, holding = false) {
  const box = useRef<HTMLTextAreaElement>(null);
  const top = useRef<number | null>(null);
  const hold = () => {
    if (box.current) top.current = box.current.getBoundingClientRect().top;
  };
  // Before the observer below sees the answer's height.
  useLayoutEffect(() => {
    if (!running) top.current = null;
  }, [running]);
  useEffect(() => {
    const el = box.current;
    let scroller = el?.parentElement ?? null;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!el?.parentElement || !scroller) return;
    if (holding) hold();
    const page = scroller;
    const letGo = () => {
      top.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key) && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) letGo();
    };
    // On the page itself is its scrollbar: everything else on it is on an element inside.
    const onPointer = (e: PointerEvent) => {
      if (e.target === page) letGo();
    };
    const moved = new ResizeObserver(() => {
      // A hidden tab has no position to keep. It comes back the same size or bigger, and this runs again.
      if (top.current === null || !el.offsetParent) return;
      page.scrollTop += el.getBoundingClientRect().top - top.current;
    });
    moved.observe(el.parentElement);
    page.addEventListener('wheel', letGo, { passive: true });
    page.addEventListener('touchmove', letGo, { passive: true });
    page.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      moved.disconnect();
      page.removeEventListener('wheel', letGo);
      page.removeEventListener('touchmove', letGo);
      page.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return { box, hold };
}

/** Why sending failed. When the step on screen is gone from the branch, reading it again is what helps, so that's on offer. */
function SendError({ error, onReload }: { error: string; onReload: () => void }) {
  return (
    <Notice tone="error" actions={error === STEP_GONE ? <Button size="sm" onClick={onReload}>Reload the review</Button> : undefined}>
      {error}
    </Notice>
  );
}

const CHECKOUT_TIP = "Checks the PR's branch out in a separate folder next to the project's (a git worktree), so the change has somewhere to happen.";

/** Checking the pull request out in a worktree, when a change has nowhere to happen yet. `checkout` says whether it worked. */
function useCheckout(data: ReviewData, onCheckout?: () => Promise<void>) {
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const canCheckout = !data.ask.change.by && !!data.ask.change.checkout && !!onCheckout;
  const checkout = async () => {
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      await onCheckout!();
      return true;
    } catch (e) {
      setCheckoutError(cleanError(e));
      return false;
    } finally {
      setCheckingOut(false);
    }
  };
  return { canCheckout, checkout, checkingOut, checkoutError };
}

function Asked({ kind, text }: PendingAsk) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-faint">{kind === 'question' ? 'You asked' : 'You asked for a change'}</span>
      <div className="text-body break-words select-text">
        <Markdown text={text} />
      </div>
    </div>
  );
}

/** A question or change that failed: send it again as it was. */
function Retry({ data, exchange }: { data: ReviewData; exchange: Exchange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const again = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.api.ask(data.projectId, data.branch, exchange.stepKey, exchange.kind, exchange.text, exchange.check);
    } catch (e) {
      setError(cleanError(e));
    }
    setBusy(false);
  };
  return (
    <Notice
      tone="error"
      actions={
        <Button size="sm" disabled={busy} aria-busy={busy} onClick={again}>
          Try again
        </Button>
      }
    >
      {error ?? exchange.error}
    </Notice>
  );
}

function Working({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-ui text-muted">
      <Loader2 size={13} className="shrink-0 animate-spin text-accent-ink" aria-hidden />
      {children}
    </div>
  );
}

/** What you asked and what came back, and the way to the new diff once the assistant changed the branch. */
export function Thread({ data, exchanges, pending, onShowChanges, loadedAt }: { data: ReviewData; exchanges: Exchange[]; pending?: PendingAsk | null; onShowChanges: () => void; loadedAt: string }) {
  const running = exchanges.some((e) => e.status === 'running');
  // The diff on screen is out of date once a change finished after the review loaded. Hunkdory then updates its
  // walkthrough so the new code lands in its step; until that's done, the new diff shows it in "Not in the walkthrough".
  const job = useWalkthroughJobFor(data.projectId, data.branch);
  const madeChange = exchanges.some((e) => e.kind === 'change' && e.status === 'done');
  const updating = madeChange && job?.status === 'running' ? job : null;
  useTick(running || !!updating);
  const changed = madeChange && (updating || exchanges.some((e) => e.kind === 'change' && e.status === 'done' && (e.finishedAt ?? '') > loadedAt) || (!!job?.finishedAt && job.finishedAt > loadedAt));

  return (
    <>
      {exchanges.map((e) => (
        <div key={e.id} className="flex flex-col gap-2 border-b border-border pb-3">
          <Asked kind={e.kind} text={e.text} />
          {e.status === 'running' && (
            <Working>
              <span className="min-w-0 flex-1 break-words">
                {e.activity ?? 'Working…'} · {since(e.at, null)}
              </span>
              <Button variant="quiet" size="sm" onClick={() => window.api.cancelExchange(data.projectId, data.branch, e.id)}>
                Stop
              </Button>
            </Working>
          )}
          {e.status === 'done' && (
            <div className="rounded-lg bg-code px-3 py-2 text-body break-words select-text">
              <Markdown text={e.reply ?? ''} />
            </div>
          )}
          {e.status === 'failed' && <Retry data={data} exchange={e} />}
          {e.status === 'cancelled' && <p className="text-ui text-muted">You stopped this.</p>}
        </div>
      ))}

      {/* Gone as soon as the real one is in the thread, which can be a moment before the send returns. */}
      {pending && !exchanges.some((e) => e.status === 'running' && e.kind === pending.kind && e.text === pending.text) && (
        <div className="flex flex-col gap-2 border-b border-border pb-3">
          <Asked {...pending} />
          <Working>
            <span className="min-w-0 flex-1 break-words">Reading the branch before {data.assistant?.name ?? 'the assistant'} starts…</span>
          </Working>
        </div>
      )}

      {changed && (
        <Notice
          tone="info"
          role="status"
          icon={updating ? <Loader2 size={14} className="mt-0.5 animate-spin" aria-hidden /> : undefined}
          actions={
            <Button size="sm" variant={updating ? 'quiet' : undefined} onClick={onShowChanges}>
              {updating ? 'Show it now' : 'Show the new diff'}
            </Button>
          }
        >
          <strong className="font-semibold">{data.assistant?.name ?? 'The assistant'} changed the branch.</strong>{' '}
          {updating ? (
            <>
              Hunkdory is updating the walkthrough so the new code shows up in this step. Shown now, it sits under “Not in the walkthrough”.
              <span className="block text-meta text-muted">
                {updating.activity ?? 'Working…'} · {since(updating.startedAt, null)}
              </span>
            </>
          ) : (
            'The diff above is from before.'
          )}
        </Notice>
      )}
    </>
  );
}

/** Questions and change requests on one step, and the box to ask the next one. */
export function AskPanel({
  data,
  step,
  exchanges,
  onShowChanges,
  loadedAt,
  draft,
  onCheckout,
}: {
  data: ReviewData;
  step: Step;
  exchanges: Exchange[];
  /** Reloads the review after the assistant changed the branch. */
  onShowChanges: () => void;
  /** When the review on screen read the branch. */
  loadedAt: string;
  /** What the box starts with, such as a GitHub comment to ask about. */
  draft?: string;
  /** Checks the pull request out in a worktree, for a change when it has nowhere to happen yet. */
  onCheckout?: () => Promise<void>;
}) {
  const [text, setText] = useState(draft ?? '');
  const { send: ask, busy, pending, error } = useSend(data, step);
  const { box, hold } = useHoldInPlace(busy || exchanges.some((e) => e.status === 'running'));
  const { canCheckout, checkout, checkingOut, checkoutError } = useCheckout(data, onCheckout);
  const canChange = !!data.ask.change.by;
  // The box empties right away: what you sent shows in the thread. It comes back if sending fails.
  const send = async (kind: Exchange['kind']) => {
    hold();
    const sent = text;
    setText('');
    if (!(await ask(kind, sent))) setText(sent);
  };

  // Manual: no assistant to ask, so there's no box, not just a disabled one.
  if (!data.ask.question.by) return null;
  const name = data.assistant?.name ?? 'the assistant';

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" aria-label={`Ask ${name} about this step`}>
      <SectionHeader as="h2">Ask {name} about this step</SectionHeader>

      <Thread data={data} exchanges={exchanges} pending={pending} onShowChanges={onShowChanges} loadedAt={loadedAt} />

      <textarea
        ref={box}
        aria-label="Your question or change"
        rows={3}
        className={TEXTAREA}
        placeholder={canChange ? 'e.g. Why not reuse the existing cache helper? or: Use the existing cache helper here.' : 'e.g. Why not reuse the existing cache helper?'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && modKey(e) && text.trim() && !busy) send('question');
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" kbd="mod+enter" disabled={!text.trim() || busy} aria-busy={busy} onClick={() => send('question')}>
          {busy ? 'Asking…' : 'Ask'}
        </Button>
        <Button variant="side" disabled={!text.trim() || busy || !canChange} onClick={() => send('change')} data-tooltip={canChange ? undefined : who(data, 'change')}>
          Ask for this change
        </Button>
        {canCheckout && (
          <Button variant="quiet" disabled={checkingOut} aria-busy={checkingOut} onClick={checkout} data-tooltip={`${CHECKOUT_TIP} Your text stays.`}>
            {checkingOut ? 'Checking out…' : 'Check out in a separate folder'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 flex-[1_1_320px] text-meta text-muted">
          {who(data, 'question')} {who(data, 'change')}
        </p>
        {canChange && <OpenInEditor data={data} />}
      </div>
      {error && <SendError error={error} onReload={onShowChanges} />}
      {checkoutError && <Notice tone="error">{checkoutError}</Notice>}
    </section>
  );
}

/**
 * Under one of a step's questions, once you answered it "Needs a change" or "Not sure": say what should change
 * (and have the assistant do it), or ask about it. What comes back shows here too, not at the bottom of the step.
 */
export function CheckFollowUp({
  data,
  step,
  index,
  value,
  note,
  onNote,
  exchanges,
  onShowChanges,
  loadedAt,
  autoFocus,
  onCheckout,
  onChangeAsked,
}: {
  data: ReviewData;
  step: Step;
  index: number;
  value: 'no' | 'unsure';
  /** What should change, as saved. */
  note: string;
  onNote: (note: string) => void;
  exchanges: Exchange[];
  onShowChanges: () => void;
  loadedAt: string;
  autoFocus?: boolean;
  /** Checks the pull request out in a worktree, so the change has somewhere to happen. */
  onCheckout?: () => Promise<void>;
  /** From "Not sure": you asked for a change after all, with this as what should change. */
  onChangeAsked: (note: string) => Promise<void>;
}) {
  const question = step.checks[index];
  const change = value === 'no';
  // A question starts from the one on screen; a change from what you said should change, unless you already asked for it.
  const [text, setText] = useState(change ? (noteWasSent(question, note, exchanges) ? '' : note) : question);
  const { send, busy, pending, error } = useSend(data, step, index);
  const { canCheckout, checkout, checkingOut, checkoutError } = useCheckout(data, onCheckout);
  const canChange = !!data.ask.change.by;
  const canAsk = !!data.ask.question.by;
  const changes = exchanges.filter((e) => e.kind === 'change');
  const name = data.assistant?.name ?? 'the assistant';
  const changeRunning = changes.some((e) => e.status === 'running');
  // Built while a change you just asked for runs: you came from "Not sure", with the same box in the same place.
  const { box, hold } = useHoldInPlace(busy || exchanges.some((e) => e.status === 'running'), changeRunning && autoFocus);
  const changeAsked = changes.some((e) => e.status !== 'failed' && e.status !== 'cancelled');

  // The note goes with your review: saved shortly after typing stops, and when you leave. The box empties once you
  // send it, but the note stays, until you write another. `sent` is the note the empty box stands for.
  const latest = useRef({ text, onNote, saved: note, sent: noteWasSent(question, note, exchanges) ? note : null });
  latest.current = { ...latest.current, text, onNote };
  const save = () => {
    const { text, onNote, saved, sent } = latest.current;
    if (!change || text.trim() === saved.trim() || (!text.trim() && sent !== null)) return;
    latest.current.saved = text;
    latest.current.sent = null;
    onNote(text);
  };
  useEffect(() => {
    const t = setTimeout(save, 800);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => save, []);

  // That run failed or you stopped it: what you asked for comes back, to send again.
  const lastStatus = changes.at(-1)?.status;
  useEffect(() => {
    const { text, sent } = latest.current;
    if ((lastStatus !== 'failed' && lastStatus !== 'cancelled') || text.trim() || !sent) return;
    latest.current.sent = null;
    setText(sent);
  }, [lastStatus]);

  const submit = async () => {
    hold();
    if (!change) {
      const sent = text;
      setText('');
      if (!(await send('question', sent))) setText(sent);
      return;
    }
    save();
    // Nowhere to change it yet: check the PR out first, then ask in the same go.
    if (!canChange && !(await checkout())) return;
    // The box empties right away: what you sent shows in the thread. It comes back if sending fails.
    const sent = text;
    latest.current.sent = sent.trim() ? sent : null;
    setText('');
    if (!(await send('change', changeRequest(question, sent)))) {
      latest.current.sent = null;
      setText(sent);
    }
  };
  const disabled = busy || checkingOut || (change ? !(canChange || canCheckout) || changeRunning || (!text.trim() && changeAsked) : !text.trim() || !canAsk);

  // From "Not sure": the box starts with the question, which says nothing about what should change.
  const typed = text.trim() === question.trim() ? '' : text.trim();
  const answered = exchanges.some((e) => e.kind === 'question' && e.status === 'done');
  // Sent first: the answer only moves to "Needs a change" once the change is really on its way.
  const askForChange = async () => {
    hold();
    if (!canChange && !(await checkout())) return;
    const before = text;
    setText('');
    if (await send('change', changeAfterQuestion(question, typed, answered))) await onChangeAsked(typed);
    else setText(before);
  };
  const changeLabel = canChange || !canCheckout ? `Ask ${name} to change it` : `Check out and ask ${name} to change it`;

  // Manual: nobody to ask. "Not sure" has nothing to offer, and "Needs a change" is a note for your review.
  if (!data.assistant && !change) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Thread data={data} exchanges={exchanges} pending={pending} onShowChanges={onShowChanges} loadedAt={loadedAt} />
      <textarea
        ref={box}
        aria-label={change ? 'What should change' : 'Your question'}
        rows={2}
        autoFocus={autoFocus}
        className={TEXTAREA}
        placeholder={change ? 'What should change? e.g. Move it to a shared helper and use it in both places.' : 'Ask about this'}
        value={text}
        onChange={(e) => {
          // Also record it synchronously, so the save on leaving sees the last keystroke.
          latest.current.text = e.target.value;
          setText(e.target.value);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && modKey(e) && !disabled) submit();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {data.assistant && (
        <Button
          variant={change ? 'side' : 'primary'}
          kbd="mod+enter"
          disabled={disabled}
          aria-busy={busy || checkingOut}
          onClick={submit}
          data-tooltip={change ? (canChange ? undefined : canCheckout ? CHECKOUT_TIP : who(data, 'change')) : !canAsk ? who(data, 'question') : undefined}
        >
          {checkingOut ? 'Checking out…' : busy ? (change ? 'Starting…' : 'Asking…') : change ? changeLabel : 'Ask'}
        </Button>
        )}
        {!change && (
          <Button
            variant="side"
            disabled={busy || checkingOut || changeRunning || !(canChange || canCheckout) || !(typed || answered)}
            aria-busy={checkingOut}
            onClick={askForChange}
            data-tooltip={!(canChange || canCheckout) ? who(data, 'change') : !(typed || answered) ? 'Ask first, or type what should change.' : canChange ? who(data, 'change') : CHECKOUT_TIP}
          >
            {changeLabel}
          </Button>
        )}
        <span className="min-w-0 flex-1 text-meta text-muted">
          {change ? (data.assistant ? <>Goes with your review as “Needs a change”, whether or not {name} changes it now. {canChange ? who(data, 'change') : ''}</> : 'Goes with your review as “Needs a change”.') : <>{who(data, 'question')} Asking for a change marks this “Needs a change”.</>}
        </span>
      </div>
      {error && <SendError error={error} onReload={onShowChanges} />}
      {checkoutError && <Notice tone="error">{checkoutError}</Notice>}
    </div>
  );
}
