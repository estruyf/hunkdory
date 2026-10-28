import { useEffect, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Loading, plural, sizeText, useAsync } from '../components/ui.tsx';
import { checksText, checksTone } from '../components/github.tsx';
import { timeAgo } from '../../shared/order.ts';
import type { InboxItem, Project, ProjectScan, ReviewState } from '../../shared/types.ts';

export function Home({ go }: { go: Go }) {
  const projects = useAsync(() => window.api.listProjects(), []);
  const inbox = useAsync(() => window.api.inbox(), []);
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Agents keep working while you look at the inbox: refresh when the window comes back,
  // at most every 30 seconds.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      inbox.reload();
    };
    window.addEventListener('focus', onFocus);
    // An agent run finishing is news: always refresh.
    const off = window.events.onReviewsChanged(() => {
      last = Date.now();
      inbox.reload();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, []);

  const all = inbox.value?.waiting ?? [];
  const q = query.trim().toLowerCase();
  const waiting = all.filter((w) => (!filter || w.projectId === filter) && (!q || `${w.title} ${w.branch} ${w.projectName}`.toLowerCase().includes(q)));
  const running = all.filter((w) => w.review?.status === 'sent-back');
  const ready = waiting.filter((w) => w.review?.status !== 'sent-back');
  const done = (inbox.value?.done ?? []).filter((d) => d.decision?.result !== 'running');
  const names = new Map(projects.value?.map((p) => [p.id, p.name]));

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => inbox.reload()} />
        <label htmlFor="search" className="sr-only">
          Search reviews
        </label>
        <input id="search" className="field" placeholder="Search branches, titles, projects" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 280px', maxWidth: 480, height: 38 }} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {inbox.loading && inbox.value && <span className="spinner" />}
          Watching {plural(projects.value?.length ?? 0, 'project')}
        </span>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20, padding: '20px 24px' }}>
        <nav aria-label="Projects" style={{ flex: '1 1 240px', maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="label" style={{ marginBottom: 6 }}>
            Projects
          </h2>
          <ProjectLink active={!filter} name="All projects" count={all.length} onClick={() => setFilter(null)} strong />
          {projects.value?.map((p) => (
            <ProjectLink
              key={p.id}
              active={filter === p.id}
              name={p.name}
              sub={sourcesLabel(p)}
              count={all.filter((w) => w.projectId === p.id).length}
              onClick={() => setFilter(p.id)}
              onSettings={() => go({ name: 'connect', projectId: p.id })}
            />
          ))}
          <button type="button" className="link" style={{ padding: '10px 12px', fontSize: 14, fontWeight: 500, textAlign: 'left' }} onClick={() => go({ name: 'connect' })}>
            + Add project
          </button>
        </nav>

        <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 22, letterSpacing: '-0.01em' }}>Waiting for you</h1>
              <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Newest first</span>
                <button type="button" className="btn" style={{ height: 34 }} onClick={() => go({ name: 'pick', projectId: filter ?? undefined })}>
                  Review a branch…
                </button>
              </span>
            </div>
            {!inbox.value && inbox.loading && <Loading label="Checking agent branches…" />}
            {inbox.error && <p className="error">{inbox.error}</p>}
            {inbox.value && ready.length === 0 && (
              <div className="card" style={{ padding: '18px 20px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {q ? (
                  'Nothing matches.'
                ) : (
                  <>
                    <span>Nothing waiting.</span>
                    {(projects.value ?? [])
                      .filter((p) => !filter || p.id === filter)
                      .map((p) => {
                        const scan = inbox.value!.scans.find((x) => x.projectId === p.id);
                        return scan ? <ScanLine key={p.id} project={p} scan={scan} go={go} /> : null;
                      })}
                  </>
                )}
              </div>
            )}
            {ready.map((w) => (
              <InboxCard key={`${w.projectId}:${w.branch}`} item={w} go={go} />
            ))}
          </section>

          {running.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 15 }}>Sent back to the agent</h2>
              {running.map((w) => (
                <RunningRow key={`${w.projectId}:${w.branch}`} item={w} state={inbox.value!.done.find((d) => d.projectId === w.projectId && d.branch === w.branch)} go={go} />
              ))}
            </section>
          )}

          {done.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 15 }}>Reviewed this week</h2>
              <div className="card" style={{ overflow: 'hidden' }}>
                {done.map((d) => (
                  <div key={d.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--divider)', fontSize: 14 }}>
                    <span style={{ fontWeight: 500, flex: '1 1 260px' }}>{d.title}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{names.get(d.projectId) ?? ''}</span>
                    <ResultPill state={d} />
                    <span style={{ color: 'var(--muted)', fontSize: 13, width: 80, textAlign: 'right' }}>{timeAgo(d.decision!.at)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function sourcesLabel(p: Project) {
  if (p.watch.mode === 'pull-requests') return `Open pull requests · ${p.github}`;
  if (p.watch.mode === 'pattern') return `Branches ${p.watch.pattern}`;
  return p.github ? 'Claude Code · GitHub' : 'Claude Code';
}

/** Why a project has nothing in the inbox, in numbers you can check. */
function ScanLine({ project, scan, go }: { project: Project; scan: ProjectScan; go: Go }) {
  const parts: string[] = [];
  if (scan.error) parts.push(scan.error);
  else if (scan.pullRequests !== null) parts.push(scan.pullRequests ? `${plural(scan.pullRequests, 'open pull request')}, none could be read.` : 'No open pull requests.');
  else {
    parts.push(`${plural(scan.sessions, 'Claude Code session')} found, working on ${plural(scan.branchesSeen, 'branch', 'branches')}.`);
    if (scan.gone) parts.push(`${scan.gone} of those no longer exist locally.`);
    if (scan.upToDate) parts.push(`${scan.upToDate} have nothing left to review against their base.`);
  }
  return (
    <span>
      <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{project.name}:</strong> {parts.join(' ')}{' '}
      <button type="button" className="link" style={{ fontSize: 14 }} onClick={() => go({ name: 'pick', projectId: project.id })}>
        Review a branch
      </button>{' '}
      ·{' '}
      <button type="button" className="link" style={{ fontSize: 14 }} onClick={() => go({ name: 'connect', projectId: project.id })}>
        Settings
      </button>
    </span>
  );
}

function ProjectLink({ name, sub, count, active, strong, onClick, onSettings }: { name: string; sub?: string; count: number; active: boolean; strong?: boolean; onClick: () => void; onSettings?: () => void }) {
  return (
    <div style={{ position: 'relative' }} className="project-link">
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        padding: '10px 12px',
        borderRadius: 8,
        background: active ? 'var(--surface)' : 'transparent',
        border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
        color: 'var(--text)',
        fontSize: 14,
        fontWeight: strong ? 600 : 400,
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: strong ? 600 : 500, fontSize: 14 }}>{name}</span>
        {sub && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span>}
      </span>
      <span className={`pill ${strong ? 'solid' : count ? 'accent' : 'neutral'}`} style={{ border: 0, marginRight: onSettings ? 30 : 0 }}>
        {count}
      </span>
    </button>
    {onSettings && (
      <button type="button" aria-label={`Settings for ${name}`} title="Project settings" onClick={onSettings} className="icon-btn" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
    )}
    </div>
  );
}

function InboxCard({ item: w, go }: { item: InboxItem; go: Go }) {
  const inProgress = !!w.review && w.review.reviewedSteps > 0 && w.review.status === 'open';
  const tag = w.updatedSinceReview ? { text: 'Updated since your review', cls: 'medium' } : inProgress ? { text: 'In progress', cls: 'low' } : { text: 'New', cls: 'accent' };
  const open = () => go(inProgress ? { name: 'review', projectId: w.projectId, branch: w.branch } : { name: 'start', projectId: w.projectId, branch: w.branch });
  return (
    <article className="card" style={{ padding: '18px 20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{w.projectName}</span>
          <span className={`pill ${tag.cls}`} style={{ border: 0 }}>
            {tag.text}
          </span>
          {w.pr && (
            <button type="button" className="pill neutral" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600 }} title="Open on GitHub" onClick={() => window.api.openExternal(w.pr!.url)}>
              PR #{w.pr.number}
              {w.pr.isDraft ? ' · draft' : ''} ↗
            </button>
          )}
          {w.tracked && (
            <span className="pill neutral" style={{ border: 0 }}>
              Picked by you
            </span>
          )}
          {w.checks.length > 0 && (
            <span className={`pill ${checksTone(w.checks)}`} style={{ border: 0 }} title="CI on GitHub">
              CI: {checksText(w.checks)}
            </span>
          )}
        </div>
        <h2 className="clamp-2" title={w.title} style={{ fontSize: 17, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
          {w.title}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 13, color: 'var(--muted)' }}>
          <span className="mono">{w.branch}</span>
          <span>{w.agent}</span>
          {!w.error && <span>{sizeText(w.files, w.added, w.removed)}</span>}
          {w.updatedAt && <span>{timeAgo(w.updatedAt)}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
        {w.error ? (
          <span className="error" style={{ fontSize: 13, maxWidth: 260 }}>
            {w.error}
          </span>
        ) : (
          <>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {inProgress ? `${w.review!.reviewedSteps} of ${plural(w.steps, 'step')} reviewed` : `${plural(w.steps, 'step')} · about ${w.minutes} min`}
              {w.walkthrough === 'skeleton' && ' · no walkthrough'}
              {w.walkthrough === 'reviewer' && ' · walkthrough by Reviewer'}
            </span>
            {w.flags.map((f) => (
              <span key={f} style={{ fontSize: 13, fontWeight: 600, color: 'var(--med-fg)' }}>
                {f}
              </span>
            ))}
          </>
        )}
      </div>
      <button type="button" className="btn primary" onClick={open} disabled={!!w.error}>
        {inProgress ? 'Continue review' : 'Start review'}
      </button>
    </article>
  );
}

function RunningRow({ item: w, state, go }: { item: InboxItem; state?: ReviewState; go: Go }) {
  const running = state?.decision?.result === 'running';
  return (
    <div className="card" style={{ borderStyle: running ? 'dashed' : 'solid', padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', fontSize: 14 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: running ? 'var(--accent)' : state?.decision?.result === 'failed' ? 'var(--high-fg)' : 'var(--low-fg)' }} />
      <span style={{ fontWeight: 600 }}>{w.title}</span>
      <span style={{ color: 'var(--muted)' }}>
        {w.projectName} · {w.agent.startsWith('GitHub Copilot') ? 'GitHub Copilot' : 'Claude Code'} · {running ? `working since ${timeAgo(state!.decision!.at)}` : w.updatedSinceReview ? 'New commits since you sent it back' : state?.decision?.message}
      </span>
      <span style={{ flex: 1 }} />
      {!running && (
        <button type="button" className="btn" onClick={() => go({ name: 'start', projectId: w.projectId, branch: w.branch })}>
          Review again
        </button>
      )}
    </div>
  );
}

export function ResultPill({ state }: { state: ReviewState }) {
  const map = {
    merged: ['Merged', 'low'],
    'sent-back': ['Sent back', 'medium'],
    discarded: ['Discarded', 'neutral'],
    reviewed: ['Reviewed on GitHub', 'low'],
    open: ['Open', 'accent'],
  } as const;
  const [text, cls] = map[state.status];
  return (
    <span className={`pill ${cls}`} style={{ border: 0 }}>
      {text}
    </span>
  );
}
