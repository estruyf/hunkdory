import type { Go } from '../App.tsx';
import { useAsync } from '../components/ui.tsx';
import type { FinishResult } from '../../shared/types.ts';

const HEADINGS = { merge: 'Merged', 'send-back': 'Sent back to Claude Code', discard: 'Discarded', github: 'Review posted on GitHub' } as const;

export function Done({ go, projectId, branch, result }: { go: Go; projectId: string; branch: string; result: FinishResult }) {
  const inbox = useAsync(() => window.api.inbox(), []);
  const decision = result.review?.decision;
  const kind = decision?.kind ?? 'merge';
  const next = inbox.value?.waiting.find((w) => !(w.projectId === projectId && w.branch === branch) && w.review?.status !== 'sent-back' && !w.error);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '96px 24px' }}>
      <div style={{ width: '100%', maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--low-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--low-fg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ fontSize: 30, letterSpacing: '-0.015em' }}>{kind === 'send-back' && decision?.github ? 'Sent back to Copilot' : HEADINGS[kind]}</h1>
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
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Next up</h2>
            <button
              type="button"
              onClick={() => go({ name: 'start', projectId: next.projectId, branch: next.branch })}
              className="card"
              style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', padding: '14px 18px', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{next.title}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {next.projectName} · {next.steps} steps
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Review now →</span>
            </button>
          </section>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type="button" className="btn lg" onClick={() => go({ name: 'home' })}>
            Back to inbox
          </button>
          <button type="button" className="btn lg" onClick={() => window.close()}>
            Close window
          </button>
        </div>
      </div>
    </div>
  );
}
