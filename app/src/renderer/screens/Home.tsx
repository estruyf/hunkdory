import { ChevronDown, ChevronUp, EyeOff, Plus, Search, Settings, Undo2 } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, Loading, plural } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { ProjectIcon } from '../components/ProjectIcon.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { Select } from '../components/ui/Select.tsx';
import { FIELD } from '../components/ui/field.ts';
import type { BranchGroup, BranchRow } from '../components/inbox/branchRows.ts';
import type { InboxData } from '../components/inbox/useInboxData.ts';
import { formatDuration } from '../../shared/order.ts';
import type { PeopleFilter } from '../../shared/people.ts';
import { matches } from '../lib/shortcuts.ts';
import { useBranches } from '../state/branches.ts';
import { openSettings, useNav } from '../state/nav.ts';
import type { Project, ProjectScan } from '../../shared/types.ts';

const SEARCH_ID = 'inbox-search';

/** ⌘P from anywhere: the inbox's search, focused and selected. From another view that means going home first. */
export function focusInboxSearch() {
  const nav = useNav.getState();
  if (nav.settings) openSettings(false);
  if (nav.route?.name !== 'home') nav.go({ name: 'home' });
  // Home may still be mounting: try again for a little while. Timers, not frames: those pause in a hidden window.
  let tries = 20;
  const focus = () => {
    const input = document.getElementById(SEARCH_ID) as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    } else if (tries-- > 0) setTimeout(focus, 25);
  };
  setTimeout(focus, 0);
}

const ROLE_LABEL = { assigned: 'Assigned to', requested: 'Review requested from', opened: 'Opened by' } as const;

function peopleLabel(f: PeopleFilter) {
  if (f === 'anyone') return 'Anyone';
  const [role, ...who] = f.split(':') as [keyof typeof ROLE_LABEL, ...string[]];
  const name = who.join(':');
  return `${ROLE_LABEL[role]} ${name === 'me' ? 'me' : name}`;
}

/** The rows you can open, in the order they show, for ↓ and Enter from the search. */
const openableRows = () => [...document.querySelectorAll<HTMLButtonElement>('[data-inbox-list] [data-branch-row]:not(:disabled)')];
/** What ↑ and ↓ move through: the rows, and each group's Show more. */
const movableRows = () => [...document.querySelectorAll<HTMLButtonElement>('[data-inbox-list] :is([data-branch-row]:not(:disabled), [data-inbox-more])')];

/** A group shows this many rows until you ask for the rest, so a busy day doesn't bury Projects. */
const GROUP_LIMIT = 5;

/**
 * The inbox: every branch waiting for you, grouped by what needs you first, as Switchboard groups its
 * sessions. A search and filters on top, your projects and why one has nothing below. ⌘↵ opens the first one.
 */
export function Home({ go, data, initialProject }: { go: Go; data: InboxData; initialProject?: string }) {
  const first = useBranches((s) => s.firstToReview);
  const [folded, setFolded] = useState<Record<string, boolean>>({ reviewed: true, ignored: true });

  // Opened on one project (from its settings): filter to it.
  useEffect(() => {
    if (initialProject) data.setProject(initialProject);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!first || !matches(e, 'home.open')) return;
      e.preventDefault();
      go({ name: 'plan', ...first });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const group = (id: BranchGroup['id']) => data.groups.find((g) => g.id === id)!;
  const waitingRows = [...group('review').rows, ...group('progress').rows];
  const waitingKeys = new Set(waitingRows.map((r) => r.key));
  const minutes = data.waiting.reduce((n, w) => n + (waitingKeys.has(`${w.projectId}:${w.branch}`) ? w.minutes : 0), 0);
  const total = data.groups.reduce((n, g) => n + g.rows.length, 0);
  const filtered = !!data.query.trim() || data.people !== 'anyone' || data.project !== 'all';
  const shownProjects = data.projects.filter((p) => data.project === 'all' || p.id === data.project);

  const peopleOptions = [
    { value: 'anyone' as PeopleFilter, label: 'Anyone' },
    ...(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).flatMap((role) => ['me', ...data.everyone[role]].map((p) => ({ value: `${role}:${p}` as PeopleFilter, label: peopleLabel(`${role}:${p}`) }))),
  ];
  if (!peopleOptions.some((o) => o.value === data.people)) peopleOptions.push({ value: data.people, label: peopleLabel(data.people) });

  // Esc clears the search (and leaves it once empty), ↓ goes to the first row, Enter opens it.
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (data.query) data.setQuery('');
      else e.currentTarget.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      openableRows()[0]?.focus();
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openableRows()[0]?.click();
    }
  };

  // ↑ and ↓ move through the rows (↑ from the first goes back to the search), E ignores the focused one or
  // brings it back; Enter opens it (it's a button).
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = movableRows();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    if (matches(e.nativeEvent, 'inbox.move')) {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      if (up && at === 0) document.getElementById(SEARCH_ID)?.focus();
      else rows[Math.min(rows.length - 1, at + (up ? -1 : 1))]?.focus();
    } else if (matches(e.nativeEvent, 'inbox.ignore')) {
      e.preventDefault();
      const row = data.groups.flatMap((g) => g.rows).find((r) => r.key === rows[at]!.dataset.branchRow);
      // On Show more there is no row: E does nothing.
      if (row && canIgnore(data.groups.find((g) => g.rows.includes(row))!.id)) void data.ignore(row, !row.ignored);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[{ label: 'Inbox' }]} />
        </div>
        <Button variant="quiet" iconOnly aria-label="Settings" shortcut="settings" icon={<Settings size={15} aria-hidden />} onClick={() => openSettings()} />
      </ViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-10 pb-14">
          {!data.loaded && data.loading ? (
            <Loading label="Checking agent branches…" />
          ) : (
            <div className="flex flex-col gap-2">
              <h1 className="text-hero font-semibold">{waitingRows.length ? `${plural(waitingRows.length, 'branch', 'branches')} waiting for your review` : 'Nothing waiting for your review'}</h1>
              <p className="text-body text-muted">
                {waitingRows.length
                  ? `About ${formatDuration(minutes)} in all, listed in the order to take them: what changed since your review first, then the smallest.`
                  : 'Agents keep working while you look away: new branches show up here as they come in.'}
              </p>
              {first && waitingRows.length > 0 && (
                <div className="pt-2">
                  <Button variant="primary" size="lg" shortcut="home.open" onClick={() => go({ name: 'plan', ...first })}>
                    Open the first one
                  </Button>
                </div>
              )}
            </div>
          )}
          {data.error && <Notice tone="error">{data.error}</Notice>}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-7 w-72 min-w-0 items-center gap-2 rounded-md border border-edge bg-bg px-2.5 text-ui text-faint focus-within:border-accent-ink">
              <Search size={13} aria-hidden />
              <input
                id={SEARCH_ID}
                value={data.query}
                onChange={(e) => data.setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search branches"
                aria-label="Search branches"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-faint"
              />
              <Kbd shortcut="branch.goto" />
            </label>
            <Select
              label="Project"
              value={data.project}
              onChange={data.setProject}
              options={[{ value: 'all', label: 'All projects' }, ...data.projects.map((p) => ({ value: p.id, label: p.name }))]}
              className={`${FIELD} w-44 min-w-0`}
            />
            <Select label="People" value={data.people} onChange={data.setPeople} options={peopleOptions} className={`${FIELD} w-52 min-w-0`} menuWidth={220} />
            <span className="flex-1" />
            <Button shortcut="branch.other" onClick={() => go({ name: 'pick', projectId: data.project === 'all' ? undefined : data.project })}>
              Review another branch…
            </Button>
          </div>

          <div data-inbox-list className="flex flex-col gap-5" onKeyDown={onListKey}>
            {data.loaded && total === 0 && <Notice>{filtered ? 'Nothing matches.' : 'Nothing waiting for you.'}</Notice>}
            {data.groups.map((g) =>
              g.rows.length === 0 ? null : <Group key={g.id} group={g} folded={g.foldable && !!folded[g.id]} onFold={() => setFolded((f) => ({ ...f, [g.id]: !f[g.id] }))} onIgnore={data.ignore} go={go} />
            )}
          </div>

          <section className="flex flex-col gap-2 pt-2">
            <div className="flex items-center gap-2">
              <SectionHeader as="h2" count={shownProjects.length} className="flex-1">
                Projects
              </SectionHeader>
              <Button variant="quiet" size="sm" icon={<Plus size={13} aria-hidden />} onClick={() => go({ name: 'connect' })}>
                Add project
              </Button>
            </div>
            {shownProjects.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-px p-0">
                {shownProjects.map((p) => (
                  <ProjectRow key={p.id} project={p} scan={data.scans.find((x) => x.projectId === p.id)} waiting={waitingRows.filter((r) => r.projectId === p.id).length} go={go} />
                ))}
              </ul>
            )}
          </section>
          <p className="flex flex-wrap items-center gap-1.5 text-meta text-faint">
            <Kbd shortcut="branch.goto" /> search · <Kbd keys="↑↓" /> move · <Kbd shortcut="inbox.ignore" /> ignore · <Kbd shortcut="shortcuts" /> every shortcut
          </p>
        </div>
      </div>
    </div>
  );
}

/** Ignore and Bring back are for what waits for you; a finished or sent-back branch isn't in To review anyway. */
const canIgnore = (id: BranchGroup['id']) => id === 'review' || id === 'progress' || id === 'ignored';

function Group({ group, folded, onFold, onIgnore, go }: { group: BranchGroup; folded: boolean; onFold(): void; onIgnore(row: BranchRow, on: boolean): void; go: Go }) {
  const [all, setAll] = useState(false);
  // One hidden row isn't worth a button in its place.
  const capped = group.rows.length > GROUP_LIMIT + 1;
  const rows = capped && !all ? group.rows.slice(0, GROUP_LIMIT) : group.rows;
  return (
    <section className="flex flex-col gap-2" aria-label={group.label}>
      <SectionHeader count={group.rows.length} className="h-6" toggle={group.foldable ? { expanded: !folded, onToggle: onFold } : undefined}>
        {group.label}
      </SectionHeader>
      {!folded && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card p-0">
          {rows.map((row) => (
            <Row key={row.key} row={row} canIgnore={canIgnore(group.id)} onIgnore={onIgnore} go={go} />
          ))}
          {capped && (
            <li className="px-2 py-1.5">
              <Button variant="quiet" size="sm" data-inbox-more icon={all ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />} aria-expanded={all} onClick={() => setAll(!all)}>
                {all ? 'Show fewer' : `Show ${group.rows.length - GROUP_LIMIT} more`}
              </Button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Row({ row, canIgnore, onIgnore, go }: { row: BranchRow; canIgnore: boolean; onIgnore(row: BranchRow, on: boolean): void; go: Go }) {
  return (
    <li className="group relative">
      <button
        type="button"
        data-branch-row={row.key}
        disabled={!!row.error}
        onClick={() => go({ name: 'plan', projectId: row.projectId, branch: row.branch })}
        data-tooltip={row.tooltip ?? undefined}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-border/45 focus-visible:bg-selected disabled:opacity-60"
      >
        <ProjectIcon name={row.projectName} size={22} />
        <span className="grid min-w-0 flex-1">
          <span className={`truncate text-body text-text ${row.unseen ? 'font-semibold' : ''}`}>{row.title}</span>
          <span className="truncate text-meta text-faint">
            {row.error ? <span className="text-error">{row.error}</span> : row.meta}
            {row.who && ` · ${row.who}`}
          </span>
        </span>
        {row.problem && <Pill tone="error">{row.problem}</Pill>}
        {row.size && <span className="hidden shrink-0 font-mono text-meta text-faint md:block">{row.size}</span>}
        <span className={`flex w-9 shrink-0 justify-end text-meta text-faint ${canIgnore ? 'group-focus-within:invisible group-hover:invisible' : ''}`}>
          {row.working ? (
            <span className="working-dots" aria-label={row.workingLabel ?? 'The agent is working'}>
              <span />
              <span />
              <span />
            </span>
          ) : (
            row.age
          )}
        </span>
      </button>
      {canIgnore && (
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          aria-label={row.ignored ? 'Bring back' : 'Ignore'}
          data-tooltip={row.ignored ? 'Bring it back to To review (E)' : 'Take it out of To review, e.g. when someone else reviews it (E)'}
          icon={row.ignored ? <Undo2 size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
          onClick={() => onIgnore(row, !row.ignored)}
          className="invisible absolute top-1/2 right-3 -translate-y-1/2 group-focus-within:visible group-hover:visible"
        />
      )}
    </li>
  );
}

/** One project: what waits, and when nothing does, why, in numbers you can check. */
function ProjectRow({ project, scan, waiting, go }: { project: Project; scan?: ProjectScan; waiting: number; go: Go }) {
  const why: string[] = [];
  if (scan?.error) why.push(scan.error);
  else if (scan && !waiting) {
    if (scan.pullRequests !== null) why.push(scan.pullRequests ? `${plural(scan.pullRequests, 'open pull request')}, none could be read.` : 'No open pull requests.');
    else {
      why.push(`${plural(scan.sessions, 'Claude Code session')} found, working on ${plural(scan.branchesSeen, 'branch', 'branches')}.`);
      if (scan.gone) why.push(`${scan.gone} of those no longer exist locally.`);
      if (scan.upToDate) why.push(`${scan.upToDate} have nothing left to review against their base.`);
    }
  }
  return (
    <li className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-border/45">
      <ProjectIcon name={project.name} size={22} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-body font-semibold">{project.name}</span>
        <span className={`text-meta ${scan?.error ? 'text-error' : 'text-faint'}`}>{waiting ? `${plural(waiting, 'branch', 'branches')} to review` : why.join(' ') || 'Nothing waiting.'}</span>
      </span>
      <Button variant="quiet" size="sm" onClick={() => go({ name: 'pick', projectId: project.id })}>
        Review another branch
      </Button>
      <Button variant="quiet" size="sm" onClick={() => go({ name: 'connect', projectId: project.id })}>
        Settings
      </Button>
    </li>
  );
}
