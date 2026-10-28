import { useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Loading, cleanError, plural, useAsync } from '../components/ui.tsx';
import { timeAgo } from '../../shared/order.ts';

/** Review any branch: yours, a colleague's, or one an agent made without a session. */
export function PickBranch({ go, initialProject }: { go: Go; initialProject?: string }) {
  const projects = useAsync(() => window.api.listProjects(), []);
  const [projectId, setProjectId] = useState(initialProject);
  const current = projectId ?? projects.value?.[0]?.id;
  // Wait for the project list, or an empty list flashes up as "no branches".
  const branches = useAsync(() => (current ? window.api.listBranches(current) : new Promise<never>(() => {})), [current]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const project = projects.value?.find((p) => p.id === current);

  const q = query.trim().toLowerCase();
  const list = (branches.value ?? []).filter((b) => !q || `${b.name} ${b.author} ${b.subject}`.toLowerCase().includes(q));

  const pick = async (name: string) => {
    try {
      await window.api.trackBranch(current!, name);
      go({ name: 'start', projectId: current!, branch: name });
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go({ name: 'home' })} />
        <span style={{ fontSize: 14, color: 'var(--muted)' }}>Review a branch</span>
      </header>
      <div style={{ width: '100%', maxWidth: 960, margin: '0 auto', padding: '32px 24px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ fontSize: 26, letterSpacing: '-0.015em' }}>Review a branch</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--muted)' }}>
            Any branch with commits on top of {project ? <span className="mono">{project.baseBranch}</span> : 'the base'}: yours, a colleague's, or an agent's. Remote branches are as fresh as your last fetch.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {(projects.value?.length ?? 0) > 1 && (
            <select aria-label="Project" className="field" value={current} onChange={(e) => setProjectId(e.target.value)}>
              {projects.value!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <input className="field" autoFocus placeholder="Search branch, author or commit message" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 320px' }} />
        </div>
        {error && <p className="error">{error}</p>}
        {branches.loading && <Loading label="Listing branches…" />}
        {branches.error && <p className="error">{branches.error}</p>}
        {branches.value && !branches.loading && (
          <section className="card" style={{ overflow: 'hidden' }}>
            {list.length === 0 && <p style={{ padding: '16px 18px', fontSize: 14, color: 'var(--muted)' }}>No branches with changes on top of the base.</p>}
            {list.map((b) => (
              <div key={b.name} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--divider)' }}>
                <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {b.name}
                    {b.remote && <span className="pill neutral" style={{ marginLeft: 8, fontFamily: 'var(--sans)' }}>remote</span>}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.author} · {timeAgo(b.updatedAt)} · {plural(b.ahead, 'commit')} · {b.subject}
                  </span>
                </div>
                {b.inInbox ? (
                  <button type="button" className="btn" onClick={() => go({ name: 'start', projectId: current!, branch: b.name })}>
                    In your inbox
                  </button>
                ) : (
                  <button type="button" className="btn primary" onClick={() => pick(b.name)}>
                    Review
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
