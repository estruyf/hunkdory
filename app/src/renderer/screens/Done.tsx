import type { Go } from '../App.tsx';
import { useEffect } from 'react';
import { Brand, Crumbs, plural, rememberReview, useInbox } from '../components/ui.tsx';
import { formatDuration, suggestedOrder } from '../../shared/order.ts';
import type { FinishResult } from '../../shared/types.ts';

const HEADINGS = { merge: 'Merged', 'send-back': 'Sent back to Claude Code', discard: 'Discarded', github: 'Review posted on GitHub' } as const;

export function Done({ go, projectId, branch, result }: { go: Go; projectId: string; branch: string; result: FinishResult }) {
  const inbox = useInbox();
  const decision = result.review?.decision;
  useEffect(() => {
    if (result.review) rememberReview(result.review);
  }, []);
  const kind = decision?.kind ?? 'merge';
  const queue = suggestedOrder(inbox.value?.waiting.filter((w) => !(w.projectId === projectId && w.branch === branch) && w.review?.status !== 'sent-back' && !w.ignored && !w.error) ?? []);
  const next = queue[0];
  const queueMinutes = queue.reduce((n, w) => n + w.minutes, 0);

  const heading = kind === 'send-back' && decision?.github ? 'Sent back to Copilot' : HEADINGS[kind];

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go({ name: 'home' })} />
        <Crumbs items={[{ label: 'Inbox', onClick: () => go({ name: 'home' }) }, { label: heading }]} />
      </header>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 24px 96px' }}>
        <div style={{ width: '100%', maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <OutcomeIcon kind={kind} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h1 style={{ fontSize: 30, letterSpacing: '-0.015em' }}>{heading}</h1>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--muted)' }}>
              {kind === 'send-back' && !decision?.github
                ? `The session picked up your ${decision?.dropStepKeys.length ? 'comments and the steps to drop' : 'comments'}. It works in the background; the branch shows up in your inbox again when it's done, and you review it from the start.`
                : result.message}
            </p>
          </div>

          {decision?.github?.url && (
            <div>
              <button type="button" className="btn" onClick={() => window.api.openExternal(decision.github!.url!)}>
                Open the review on GitHub ↗
              </button>
            </div>
          )}

          {kind === 'send-back' && !decision?.github && (
            <section className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)' }} />
                <span style={{ fontWeight: 600 }}>Agent working</span>
                <span style={{ color: 'var(--muted)' }}>{branch} · started just now</span>
              </div>
              {decision?.logFile && (
                <button type="button" className="link" style={{ fontSize: 13.5, textAlign: 'left' }} onClick={() => window.api.openSessionFile(decision.logFile!)}>
                  Show the run log
                </button>
              )}
            </section>
          )}

          {next && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>
                Next up{' '}
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                  · {plural(queue.length, 'branch', 'branches')} waiting, about {formatDuration(queueMinutes)} in all
                </span>
              </h2>
              <button
                type="button"
                onClick={() => go({ name: 'plan', projectId: next.projectId, branch: next.branch })}
                className="card"
                style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', padding: '14px 18px', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{next.title}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {next.projectName} · {plural(next.steps, 'step')} · about {formatDuration(next.minutes)}
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Review now →</span>
              </button>
            </section>
          )}

          <div>
            <button type="button" className="btn lg" onClick={() => go({ name: 'home' })}>
              Back to inbox
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One picture per outcome: a tick for a merge, an arrow for work going back, a bin for a discard, a speech bubble for a posted review. */
function OutcomeIcon({ kind }: { kind: keyof typeof HEADINGS }) {
  const look = {
    merge: { bg: 'var(--low-bg)', fg: 'var(--low-fg)', d: ['M5 12l5 5 9-10'] },
    'send-back': { bg: 'var(--accent-tint)', fg: 'var(--accent)', d: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] },
    discard: { bg: 'var(--neutral-bg)', fg: 'var(--muted)', d: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'] },
    github: { bg: 'var(--low-bg)', fg: 'var(--low-fg)', d: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  }[kind];
  return (
    <div style={{ width: 56, height: 56, borderRadius: 999, background: look.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={look.fg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {look.d.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  );
}
