import { useEffect, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, GearIcon, Loading, isPlainKey, plural, sizeText, useAsync, useInbox, usePref, useShortcutSheet } from '../components/ui.tsx';
import { checkCounts } from '../components/github.tsx';
import { formatDuration, suggestedOrder, timeAgo, tooBig } from '../../shared/order.ts';
import { githubLink } from '../../shared/decisions.ts';
import { hidesLocal, matchesPeople, peopleLine, peopleOptions, type PeopleFilter } from '../../shared/people.ts';
import type { InboxItem, Project, ProjectScan, ReviewState } from '../../shared/types.ts';

export function Home({ go, initialProject }: { go: Go; initialProject?: string }) {
  const projects = useAsync(() => window.api.listProjects(), []);
  const inbox = useInbox();
  // Always opens on Waiting for you, even when it's empty and another tab isn't.
  const [tab, setTab] = useState<Tab>('waiting');
  const [filter, setFilter] = useState<string | null>(initialProject ?? null);
  const [query, setQuery] = useState('');
  const [order, setOrder] = usePref<'suggested' | 'newest'>('inbox-order', 'suggested');
  const [people, setPeople] = usePref<PeopleFilter>('inbox-people', 'anyone');
  // The row j and k move to, and Enter opens.
  const [sel, setSel] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const me = inbox.value?.me ?? null;
  const everyone = peopleOptions((inbox.value?.waiting ?? []).filter((w) => !w.ignored), me);
  // The People filter narrows every list built from inbox items, the project counts included.
  const all = (inbox.value?.waiting ?? []).filter((w) => !w.ignored && matchesPeople(w, people, me));
  const q = query.trim().toLowerCase();
  const shown = (w: InboxItem) => (!filter || w.projectId === filter) && (!q || `${w.title} ${w.branch} ${w.projectName}`.toLowerCase().includes(q)) && matchesPeople(w, people, me);
  const waiting = all.filter(shown);
  const ignored = (inbox.value?.waiting ?? []).filter((w) => w.ignored && shown(w));
  const running = waiting.filter((w) => w.review?.status === 'sent-back');
  const unsent = waiting.filter((w) => w.review?.status !== 'sent-back');
  // The main process lists newest first.
  const ready = order === 'suggested' ? suggestedOrder(unsent) : unsent;
  const names = new Map(projects.value?.map((p) => [p.id, p.name]));
  const done = (inbox.value?.done ?? []).filter(
    (d) => d.decision?.result !== 'running' && (!filter || d.projectId === filter) && (!q || `${d.title} ${d.branch} ${names.get(d.projectId) ?? ''}`.toLowerCase().includes(q))
  );
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'waiting', label: 'Waiting for you', count: ready.length },
    { id: 'sent', label: 'Sent back', count: running.length },
    { id: 'reviewed', label: 'Reviewed this week', count: done.length },
    { id: 'ignored', label: 'Ignored', count: ignored.length },
  ];

  // The list changes right away; the scan after it brings in the size and flags of a branch you bring back.
  const ignore = async (w: InboxItem, on: boolean) => {
    inbox.patch((v) => ({ ...v, waiting: v.waiting.map((x) => (x.projectId === w.projectId && x.branch === w.branch ? { ...x, ignored: on } : x)) }));
    await window.api.ignoreBranch(w.projectId, w.branch, on);
    inbox.reload();
  };
  const openItem = (w: InboxItem) => !w.error && go({ name: 'plan', projectId: w.projectId, branch: w.branch });

  const at = Math.min(sel, Math.max(0, ready.length - 1));
  const sheet = useShortcutSheet([
    ['j', 'Next branch'],
    ['k', 'Previous branch'],
    ['↵', 'Open the selected branch'],
    ['i', 'Ignore the selected branch'],
    ['/', 'Search'],
    ['b', 'Review another branch'],
    ['?', 'This list'],
  ]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e) || sheet.open) return;
      const inList = tab === 'waiting' && ready.length > 0;
      const move = (to: number) => {
        e.preventDefault();
        setSel(to);
        document.getElementById(`row-${to}`)?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'b') {
        e.preventDefault();
        go({ name: 'pick', projectId: filter ?? undefined });
      } else if (inList && (e.key === 'j' || e.key === 'ArrowDown') && !(e.target as HTMLElement).closest('[role="tablist"]')) move(Math.min(ready.length - 1, at + 1));
      else if (inList && (e.key === 'k' || e.key === 'ArrowUp') && !(e.target as HTMLElement).closest('[role="tablist"]')) move(Math.max(0, at - 1));
      else if (inList && e.key === 'Enter' && !(e.target as HTMLElement).closest('button, a')) {
        e.preventDefault();
        openItem(ready[at]);
      } else if (inList && e.key === 'i') {
        e.preventDefault();
        ignore(ready[at], true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const scanOf = (p: Project) => inbox.value?.scans.find((x) => x.projectId === p.id);

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => inbox.reload()} />
        <label htmlFor="search" className="sr-only">
          Search reviews
        </label>
        <input ref={searchRef} id="search" className="field" placeholder="Search branches, titles, projects   /" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()} style={{ flex: '1 1 280px', maxWidth: 480, height: 38 }} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {inbox.loading && inbox.value && <span className="spinner" />}
          Watching {plural(projects.value?.length ?? 0, 'project')}
        </span>
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => go({ name: 'settings' })} style={{ width: 34, height: 34, opacity: 1, flex: 'none' }}>
          <GearIcon size={18} />
        </button>
      </header>
      {sheet.sheet}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20, padding: '20px 24px' }}>
        {/* The project list stays in view under the header while the inbox scrolls. */}
        <nav aria-label="Projects" style={{ flex: '1 1 220px', maxWidth: 260, display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 'calc(var(--topbar-h) + 20px)', maxHeight: 'calc(100vh - var(--topbar-h) - 40px)', overflowY: 'auto' }}>
          <h2 className="label" style={{ marginBottom: 6 }}>
            Projects
          </h2>
          <ProjectLink active={!filter} name="All projects" count={all.length} onClick={() => setFilter(null)} strong />
          {projects.value?.map((p) => (
            <ProjectLink key={p.id} active={filter === p.id} name={p.name} problem={scanOf(p)?.error ?? null} count={all.filter((w) => w.projectId === p.id).length} onClick={() => setFilter(p.id)} onSettings={() => go({ name: 'connect', projectId: p.id })} />
          ))}
          <button type="button" className="link" style={{ padding: '10px 12px', fontSize: 14, fontWeight: 500, textAlign: 'left' }} onClick={() => go({ name: 'connect' })}>
            + Add project
          </button>
        </nav>

        <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 className="sr-only">Inbox</h1>
          <Tabs tabs={tabs} current={tab} onChange={setTab} />
          {inbox.error && <p className="error">{inbox.error}</p>}

          {/* One filter bar for every tab: what narrows a list is always in sight. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <PeopleSelect value={people} onChange={setPeople} everyone={everyone} />
            {tab === 'waiting' && (
              <>
                <label className="sr-only" htmlFor="inbox-order">
                  Order
                </label>
                <select id="inbox-order" className="field" value={order} onChange={(e) => setOrder(e.target.value as 'suggested' | 'newest')} style={{ height: 34, fontSize: 13, padding: '0 8px' }}>
                  <option value="suggested">What to review first</option>
                  <option value="newest">Newest first</option>
                </select>
              </>
            )}
            <span style={{ flex: 1 }} />
            {sheet.button}
            <button type="button" className="btn" style={{ height: 34 }} onClick={() => go({ name: 'pick', projectId: filter ?? undefined })}>
              Review another branch…
            </button>
          </div>

          <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!inbox.value && inbox.loading && <Loading label="Checking agent branches…" />}

            {tab === 'waiting' && inbox.value && ready.length === 0 && (
              <div className="card" style={emptyCard}>
                {q || people !== 'anyone' ? (
                  <>
                    <span>Nothing matches.</span>
                    {hidesLocal(people) && <span>{hidesLocal(people)}</span>}
                  </>
                ) : (
                  <>
                    <span>Nothing waiting.</span>
                    {(projects.value ?? [])
                      .filter((p) => !filter || p.id === filter)
                      .map((p) => {
                        const scan = scanOf(p);
                        return scan ? <ScanLine key={p.id} project={p} scan={scan} go={go} /> : null;
                      })}
                  </>
                )}
              </div>
            )}
            {tab === 'waiting' && ready.map((w, i) => <InboxRow key={`${w.projectId}:${w.branch}`} n={i} item={w} me={me} selected={i === at} onOpen={() => openItem(w)} onFocus={() => setSel(i)} onIgnore={() => ignore(w, true)} />)}

            {tab === 'sent' && inbox.value && running.length === 0 && <div className="card" style={emptyCard}>{q ? 'Nothing matches.' : 'Nothing is with an agent right now. Reviews you send back show here while the agent works on them.'}</div>}
            {tab === 'sent' && running.map((w) => <RunningRow key={`${w.projectId}:${w.branch}`} item={w} state={inbox.value!.done.find((d) => d.projectId === w.projectId && d.branch === w.branch)} go={go} />)}

            {tab === 'reviewed' && inbox.value && done.length === 0 && <div className="card" style={emptyCard}>{q ? 'Nothing matches.' : 'Nothing reviewed in the last seven days.'}</div>}
            {tab === 'reviewed' && done.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                {done.map((d) => (
                  <div key={d.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--divider)', fontSize: 14 }}>
                    <span style={{ fontWeight: 500, flex: '1 1 260px' }}>{d.title}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{names.get(d.projectId) ?? ''}</span>
                    <ResultPill state={d} />
                    <GitHubLink url={githubLink(d.decision)} />
                    <span style={{ color: 'var(--muted)', fontSize: 13, width: 80, textAlign: 'right' }}>{timeAgo(d.decision!.at)}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'ignored' && inbox.value && ignored.length === 0 && <div className="card" style={emptyCard}>{q ? 'Nothing matches.' : 'Nothing ignored. Ignore takes a branch out of Waiting for you, e.g. when someone else reviews it on GitHub.'}</div>}
            {tab === 'ignored' && ignored.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                {ignored.map((w) => (
                  <div key={`${w.projectId}:${w.branch}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--divider)', fontSize: 14 }}>
                    <span style={{ fontWeight: 500, flex: '1 1 260px' }}>{w.title}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {w.projectName}
                      {w.pr && ` · PR #${w.pr.number}`}
                    </span>
                    <button type="button" className="btn" style={{ height: 32 }} onClick={() => ignore(w, false)}>
                      Bring back
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

type Tab = 'waiting' | 'sent' | 'reviewed' | 'ignored';

const emptyCard: React.CSSProperties = { padding: '18px 20px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 8 };

/** The inbox's lists as tabs. Arrow keys, Home and End move between them, like any tab list. */
function Tabs({ tabs, current, onChange }: { tabs: { id: Tab; label: string; count: number }[]; current: Tab; onChange: (t: Tab) => void }) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === current);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    onChange(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Inbox" className="tabs" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === current} aria-controls={`panel-${t.id}`} tabIndex={t.id === current ? 0 : -1} className="tab" onClick={() => onChange(t.id)}>
          {t.label}
          <span className={`pill ${t.id === current ? 'accent' : 'neutral'}`} style={{ border: 0 }}>
            {t.count}
          </span>
        </button>
      ))}
    </div>
  );
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
        Review another branch
      </button>{' '}
      ·{' '}
      <button type="button" className="link" style={{ fontSize: 14 }} onClick={() => go({ name: 'connect', projectId: project.id })}>
        Settings
      </button>
    </span>
  );
}


function ProjectLink({ name, count, active, strong, problem, onClick, onSettings }: { name: string; count: number; active: boolean; strong?: boolean; problem?: string | null; onClick: () => void; onSettings?: () => void }) {
  return (
    <div style={{ position: 'relative' }} className="project-link">
      <button
        type="button"
        onClick={onClick}
        title={problem ?? undefined}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', borderRadius: 8, background: active ? 'var(--surface)' : 'transparent', border: `1px solid ${active ? 'var(--border)' : 'transparent'}`, color: 'var(--text)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {problem && <span className="status-dot" style={{ width: 8, height: 8, background: 'var(--high-fg)' }} aria-label="Scan problem" />}
          <span style={{ fontWeight: strong ? 600 : 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </span>
        <span className={`pill ${strong ? 'solid' : count ? 'accent' : 'neutral'}`} style={{ border: 0, marginRight: onSettings ? 30 : 0 }}>
          {count}
        </span>
      </button>
      {onSettings && (
        <button type="button" aria-label={`Settings for ${name}`} title="Project settings" onClick={onSettings} className="icon-btn" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}>
          <GearIcon />
        </button>
      )}
    </div>
  );
}

/** One warning at most: the one that most changes whether you start now. */
function warningOf(w: InboxItem): { text: string; cls: string; hint: string } | null {
  if (w.error) return null;
  if (checkCounts(w.checks).fail) return { text: 'CI failing', cls: 'high', hint: 'A check on GitHub failed.' };
  if (tooBig(w)) return { text: 'Too big for one sitting', cls: 'high', hint: 'More than one sitting can take in. Ask the agent to split it, or review it over several sittings.' };
  return null;
}

/** A branch waiting for you: a status dot, the title, one line of facts, and at most one warning. The whole row opens it. */
function InboxRow({ item: w, n, me, selected, onOpen, onFocus, onIgnore }: { item: InboxItem; n: number; me: string | null; selected: boolean; onOpen: () => void; onFocus: () => void; onIgnore: () => void }) {
  const who = peopleLine(w, me);
  const inProgress = !!w.review && w.review.reviewedSteps > 0 && w.review.status === 'open';
  const status = w.error
    ? { text: 'Can’t open', color: 'var(--high-fg)' }
    : w.updatedSinceReview
      ? { text: 'Updated since your review', color: 'var(--med-fg)' }
      : inProgress
        ? { text: 'In progress', color: 'var(--low-fg)' }
        : { text: 'New', color: 'var(--accent)' };
  const left = inProgress ? Math.max(1, Math.round(w.minutes * (1 - w.review!.reviewedSteps / Math.max(1, w.steps)))) : w.minutes;
  const warn = warningOf(w);
  return (
    <div className="row-wrap" data-selected={selected}>
      <button type="button" id={`row-${n}`} className="inbox-row" onClick={onOpen} onFocus={onFocus} disabled={!!w.error} aria-describedby={`row-${n}-meta`}>
        <span className="status-dot" style={{ background: status.color }} title={status.text} aria-label={status.text} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="clamp-2" title={w.title} style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
            {w.title}
          </span>
          <span id={`row-${n}-meta`} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', fontSize: 13, color: 'var(--muted)' }}>
            {w.error ? (
              <span className="error" style={{ fontSize: 13 }}>
                {w.error}
              </span>
            ) : (
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{inProgress ? `${formatDuration(left)} left · ${w.review!.reviewedSteps} of ${plural(w.steps, 'step')}` : `About ${formatDuration(left)}`}</strong>
            )}
            {status.text !== 'New' && status.text !== 'In progress' && !w.error && <span>· {status.text.toLowerCase()}</span>}
            <span>· {w.projectName}</span>
            <span>
              · <span className="mono">{w.branch}</span>
            </span>
            {!w.error && <span>· {sizeText(w.files, w.added, w.removed)}</span>}
            {w.pr && <span>· PR #{w.pr.number}{w.pr.isDraft ? ' (draft)' : ''}</span>}
            {w.buildsOn && <span title={`This branch starts from ${w.buildsOn.branch}, so that branch's changes show up in this review too.`}>· builds on {w.buildsOn.pr ? `PR #${w.buildsOn.pr}` : w.buildsOn.branch}</span>}
            {w.updatedAt && <span>· {timeAgo(w.updatedAt)}</span>}
          </span>
          {who && <span style={{ fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{who}</span>}
        </span>
        {warn && (
          <span className={`pill ${warn.cls}`} style={{ border: 0 }} title={warn.hint}>
            {warn.text}
          </span>
        )}
        {!w.error && <span className="row-go">{inProgress ? 'Continue →' : 'Review →'}</span>}
      </button>
      <button type="button" className="btn row-extra" style={{ height: 32, border: 0, color: 'var(--muted)', background: 'transparent' }} title="Take it out of your inbox, e.g. when someone else reviews it on GitHub. You can bring it back from Ignored. (i)" onClick={onIgnore}>
        Ignore
      </button>
    </div>
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
        <button type="button" className="btn" onClick={() => go({ name: 'plan', projectId: w.projectId, branch: w.branch })}>
          Review again
        </button>
      )}
    </div>
  );
}

const ROLE_LABEL = { assigned: 'Assigned to', requested: 'Review requested from', opened: 'Opened by' } as const;

/** "Assigned to me", "Opened by alice": the filter as words. */
function peopleLabel(f: PeopleFilter) {
  if (f === 'anyone') return 'Anyone';
  const [role, ...who] = f.split(':') as [keyof typeof ROLE_LABEL, ...string[]];
  const name = who.join(':');
  return `${ROLE_LABEL[role]} ${name === 'me' ? 'me' : name}`;
}

/** Anyone, or one person in one role. Each group has Me first, then everyone on the inbox's items. */
function PeopleSelect({ value, onChange, everyone }: { value: PeopleFilter; onChange: (v: PeopleFilter) => void; everyone: Record<keyof typeof ROLE_LABEL, string[]> }) {
  const roles = Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[];
  // A remembered person who isn't on any item today still shows, so the select never looks unfiltered.
  const known = value === 'anyone' || value.endsWith(':me') || roles.some((r) => everyone[r].some((p) => `${r}:${p}` === value));
  return (
    <>
      <label className="sr-only" htmlFor="inbox-people">
        People
      </label>
      <select id="inbox-people" className="field" value={value} onChange={(e) => onChange(e.target.value as PeopleFilter)} style={{ height: 34, fontSize: 13, padding: '0 8px', maxWidth: 260 }}>
        <option value="anyone">Anyone</option>
        {!known && <option value={value}>{peopleLabel(value)}</option>}
        {roles.map((r) => (
          <optgroup key={r} label={`${ROLE_LABEL[r]}…`}>
            {['me', ...everyone[r]].map((p) => (
              <option key={p} value={`${r}:${p}`}>
                {peopleLabel(`${r}:${p}`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </>
  );
}

/** Where the decision went on GitHub. Keeps its width when there's none, so the dates line up. */
function GitHubLink({ url }: { url: string | null }) {
  return (
    <span style={{ width: 128, display: 'flex', justifyContent: 'flex-end' }}>
      {url && (
        <button type="button" className="pill neutral" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600 }} title={url} onClick={() => window.api.openExternal(url)}>
          View on GitHub ↗
        </button>
      )}
    </span>
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
