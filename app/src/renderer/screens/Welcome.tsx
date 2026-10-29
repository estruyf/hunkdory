import type { Go } from '../App.tsx';
import { Brand, Later } from '../components/ui.tsx';
import { FoundOnThisMac } from '../components/found.tsx';

export function Welcome({ go }: { go: Go }) {
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px 72px' }}>
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1 style={{ fontSize: 40, lineHeight: 1.15, letterSpacing: '-0.02em' }}>Review what your agents wrote, one step at a time.</h1>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 620 }}>
              Connect a project. Hunkdory picks up the branches your coding agents create, reads the session that produced them, and splits each change into steps you can follow. Every changed line belongs to a step, and anything you didn't ask for is called out.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <button type="button" onClick={() => go({ name: 'connect' })} style={{ ...tile, border: '1px solid var(--accent)', boxShadow: '0 1px 3px var(--shadow)', cursor: 'pointer' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Add a local project</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Pick a folder with a git repo. Works fully offline.</span>
            </button>
            <div style={{ ...tile, opacity: 0.6 }} aria-disabled="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                Clone from GitHub
                <Later />
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Uses your GitHub CLI sign-in. Pulls in open agent PRs too.</span>
            </div>
          </div>

          <FoundOnThisMac onPick={(path) => go({ name: 'connect', path })} />

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

const tile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 22,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text)',
  textAlign: 'left',
  font: 'inherit',
};
