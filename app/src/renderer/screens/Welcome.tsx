import type { Go } from '../App.tsx';
import { Brand } from '../components/ui.tsx';
import { FoundOnThisMac } from '../components/found.tsx';

/** First run: the repos you already use with Claude Code are the way in. */
export function Welcome({ go }: { go: Go }) {
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px 72px' }}>
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1 style={{ fontSize: 40, lineHeight: 1.15, letterSpacing: '-0.02em' }}>Review what your agents wrote, one step at a time.</h1>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 620 }}>
              Connect a project. Hunkdory picks up the branches your coding agents create, reads the session that produced them, and splits each change into steps you can follow. Every changed line belongs to a step, and anything you didn't ask for is called out.
            </p>
          </div>

          <FoundOnThisMac onPick={(path) => go({ name: 'connect', path })} title="You use Claude Code in these repos" />

          <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 15, fontWeight: 500 }} onClick={() => go({ name: 'connect' })}>
            Choose another folder…
          </button>

          <p style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Hunkdory runs on your machine. It only sends code to Claude when you let it write a walkthrough, ask a question, or send work back.
          </p>
        </div>
      </div>
    </div>
  );
}
