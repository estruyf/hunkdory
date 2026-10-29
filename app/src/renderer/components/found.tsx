import { Loading, plural, useAsync } from './ui.tsx';
import { timeAgo } from '../../shared/order.ts';

/** Repos with recent Claude Code sessions that aren't projects yet. Connected repos drop out of the list. */
export function FoundOnThisMac({ onPick, title = 'Found on this Mac' }: { onPick: (path: string) => void; title?: string }) {
  const found = useAsync(() => window.api.foundOnThisMac(), []);
  return (
    <section className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>Folders with recent coding agent sessions. Pick one to connect it.</p>
      </div>
      {found.loading && <Loading label="Looking for Claude Code sessions…" />}
      {found.error && <p className="error">{found.error}</p>}
      {found.value?.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)', padding: '8px 0' }}>No other repos with Claude Code sessions in your Claude Code config folders (~/.claude and any ~/.claude-*).</p>}
      {found.value?.map((f, i) => (
        <div key={f.path} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 0', borderTop: '1px solid var(--divider)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</span>
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
              {f.path}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Claude Code · {plural(f.sessions, 'session')} · {timeAgo(f.lastActive)}
            </span>
            <button type="button" className={i === 0 ? 'btn primary' : 'btn'} style={{ height: 36, padding: '0 14px' }} aria-label={`Connect ${f.name}`} onClick={() => onPick(f.path)}>
              Connect
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
