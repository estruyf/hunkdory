import { useEffect, useState } from 'react';
import type { Exchange, ReviewData, Step } from '../../shared/types.ts';
import { Markdown } from './markdown.tsx';
import { cleanError } from './ui.tsx';

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

/** Questions and change requests on one step, and the box to ask the next one. */
export function AskPanel({
  data,
  step,
  exchanges,
  onShowChanges,
}: {
  data: ReviewData;
  step: Step;
  exchanges: Exchange[];
  /** Reloads the review after Claude changed the branch. */
  onShowChanges: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = exchanges.some((e) => e.status === 'running');
  useTick(running);
  const canChange = !!data.ask.change.by;
  // The diff on screen is out of date once a change finished after the review loaded.
  const changed = exchanges.some((e) => e.kind === 'change' && e.status === 'done');

  const send = async (kind: Exchange['kind']) => {
    setBusy(true);
    setError(null);
    try {
      await window.api.ask(data.projectId, data.branch, step.key, kind, text);
      setText('');
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Ask Claude about this step" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600 }}>Ask Claude about this step</h2>

      {exchanges.map((e) => (
        <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--divider)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="label-sm">{e.kind === 'question' ? 'You asked' : 'You asked for a change'}</span>
            <p style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.text}</p>
          </div>
          {e.status === 'running' && (
            <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--muted)' }}>
              <span className="spinner" style={{ flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {e.activity ?? 'Working…'} · {since(e.at, null)}
              </span>
              <button type="button" className="link" style={{ fontSize: 13, fontWeight: 600 }} onClick={() => window.api.cancelExchange(data.projectId, data.branch, e.id)}>
                Stop
              </button>
            </div>
          )}
          {e.status === 'done' && (
            <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-body)', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, overflowWrap: 'anywhere' }}>
              <Markdown text={e.reply ?? ''} />
            </div>
          )}
          {e.status === 'failed' && <p className="error">{e.error}</p>}
          {e.status === 'cancelled' && <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>You stopped this.</p>}
        </div>
      ))}

      {changed && (
        <div className="notice info" role="status">
          <span>
            <strong>Claude changed the branch.</strong> The diff above is from before.{' '}
            <button type="button" className="link" style={{ fontSize: 13.5, fontWeight: 600 }} onClick={onShowChanges}>
              Show the new diff
            </button>
          </span>
        </div>
      )}

      <textarea
        aria-label="Your question or change"
        rows={3}
        className="textarea"
        placeholder={canChange ? 'e.g. Why not reuse the existing cache helper? or: Use the existing cache helper here.' : 'e.g. Why not reuse the existing cache helper?'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && !busy) send('question');
        }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn primary" disabled={!text.trim() || busy} onClick={() => send('question')} title="⌘↩">
          Ask
        </button>
        <button type="button" className="btn" disabled={!text.trim() || busy || !canChange} onClick={() => send('change')} title={canChange ? undefined : who(data, 'change')}>
          Ask for this change
        </button>
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
        {who(data, 'question')} {who(data, 'change')}
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
