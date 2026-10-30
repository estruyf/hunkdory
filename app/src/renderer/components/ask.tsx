import { useEffect, useRef, useState } from 'react';
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
  if (kind === 'question') {
    return a.question.by === 'session-copy'
      ? 'The agent that wrote this branch answers, from a copy of its session. It can’t change anything.'
      : 'Claude answers from the code. It can’t change anything.';
  }
  if (!a.change.by) return a.change.reason;
  return a.change.by === 'session' ? `The agent’s own session makes the change, in ${a.change.where}.` : `Claude edits the files in ${a.change.where}. Nothing is committed.`;
}

/** Asking Claude from one step, or from one of its questions. */
function useSend(data: ReviewData, step: Step, check?: number) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (kind: Exchange['kind'], text: string) => {
    setBusy(true);
    setError(null);
    try {
      await window.api.ask(data.projectId, data.branch, step.key, kind, text, check);
      return true;
    } catch (e) {
      setError(cleanError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, error };
}

/** What you asked and what came back, and the way to the new diff once Claude changed the branch. */
export function Thread({ data, exchanges, onShowChanges, loadedAt }: { data: ReviewData; exchanges: Exchange[]; onShowChanges: () => void; loadedAt: string }) {
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
          <div className="flex flex-col gap-0.5">
            <span className="text-meta text-faint">{e.kind === 'question' ? 'You asked' : 'You asked for a change'}</span>
            <div className="text-body break-words select-text">
              <Markdown text={e.text} />
            </div>
          </div>
          {e.status === 'running' && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-ui text-muted">
              <Loader2 size={13} className="shrink-0 animate-spin text-accent-ink" aria-hidden />
              <span className="min-w-0 flex-1 break-words">
                {e.activity ?? 'Working…'} · {since(e.at, null)}
              </span>
              <Button variant="quiet" size="sm" onClick={() => window.api.cancelExchange(data.projectId, data.branch, e.id)}>
                Stop
              </Button>
            </div>
          )}
          {e.status === 'done' && (
            <div className="rounded-lg bg-code px-3 py-2 text-body break-words select-text">
              <Markdown text={e.reply ?? ''} />
            </div>
          )}
          {e.status === 'failed' && <Notice tone="error">{e.error}</Notice>}
          {e.status === 'cancelled' && <p className="text-ui text-muted">You stopped this.</p>}
        </div>
      ))}

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
          <strong className="font-semibold">Claude changed the branch.</strong>{' '}
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
}: {
  data: ReviewData;
  step: Step;
  exchanges: Exchange[];
  /** Reloads the review after Claude changed the branch. */
  onShowChanges: () => void;
  /** When the review on screen read the branch. */
  loadedAt: string;
}) {
  const [text, setText] = useState('');
  const { send: ask, busy, error } = useSend(data, step);
  const canChange = !!data.ask.change.by;
  const send = async (kind: Exchange['kind']) => {
    if (await ask(kind, text)) setText('');
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" aria-label="Ask Claude about this step">
      <SectionHeader as="h2">Ask Claude about this step</SectionHeader>

      <Thread data={data} exchanges={exchanges} onShowChanges={onShowChanges} loadedAt={loadedAt} />

      <textarea
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
        <Button disabled={!text.trim() || busy || !canChange} onClick={() => send('change')} data-tooltip={canChange ? undefined : who(data, 'change')}>
          Ask for this change
        </Button>
      </div>
      <p className="text-meta text-muted">
        {who(data, 'question')} {who(data, 'change')}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

/**
 * Under one of a step's questions, once you answered it "Needs a change" or "Not sure": say what should change
 * (and have Claude do it), or ask about it. What comes back shows here too, not at the bottom of the step.
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
}) {
  const question = step.checks[index];
  const change = value === 'no';
  // A question starts from the one on screen; a change from what you said should change.
  const [text, setText] = useState(change ? note : question);
  const { send, busy, error } = useSend(data, step, index);
  const canChange = !!data.ask.change.by;
  const changeRunning = exchanges.some((e) => e.kind === 'change' && e.status === 'running');

  // The note goes with your review: saved shortly after typing stops, and when you leave.
  const latest = useRef({ text, onNote, saved: note });
  latest.current = { ...latest.current, text, onNote };
  const save = () => {
    const { text, onNote, saved } = latest.current;
    if (!change || text.trim() === saved.trim()) return;
    latest.current.saved = text;
    onNote(text);
  };
  useEffect(() => {
    const t = setTimeout(save, 800);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => save, []);

  const submit = async () => {
    if (!change) {
      if (await send('question', text)) setText('');
      return;
    }
    save();
    await send('change', text.trim() ? `${question}\n\n${text.trim()}` : question);
  };
  const disabled = busy || (change ? !canChange || changeRunning : !text.trim());

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Thread data={data} exchanges={exchanges} onShowChanges={onShowChanges} loadedAt={loadedAt} />
      <textarea
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
        <Button
          variant="primary"
          kbd="mod+enter"
          disabled={disabled}
          aria-busy={busy}
          onClick={submit}
          data-tooltip={change && !canChange ? who(data, 'change') : undefined}
        >
          {busy ? (change ? 'Starting…' : 'Asking…') : change ? 'Ask Claude to change it' : 'Ask'}
        </Button>
        <span className="min-w-0 flex-1 text-meta text-muted">
          {change ? <>Goes with your review as “Needs a change”, whether or not Claude changes it now. {canChange ? who(data, 'change') : ''}</> : who(data, 'question')}
        </span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
