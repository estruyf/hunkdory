import { EyeOff, Plus, Search, Settings, Undo2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { PeopleFilter } from '../../../shared/people.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { matches } from '../../lib/shortcuts.ts';
import { openSettings, useNav } from '../../state/nav.ts';
import { useSidebar } from '../../state/sidebar.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { Select } from '../ui/Select.tsx';
import { FIELD } from '../ui/field.ts';
import { Loading } from '../ui.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import type { BranchGroup, BranchRow } from './branchRows.ts';
import type { SidebarData } from './useSidebarData.ts';

export const SEARCH_ID = 'sidebar-search';

/** Opens a branch's plan from the sidebar. */
export function openRow(row: Pick<BranchRow, 'projectId' | 'branch'>) {
  useNav.getState().go({ name: 'plan', projectId: row.projectId, branch: row.branch });
}

/** ⌘P: the sidebar's search. During a review that means leaving it for the inbox, where the sidebar is. */
export function openSidebarSearch() {
  const s = useSidebar.getState();
  if (s.reviewing) useNav.getState().go({ name: 'home' });
  if (s.state !== 'open') s.setState('open');
  setTimeout(() => document.getElementById(SEARCH_ID)?.focus(), 50);
}

/** The selected branch: the one the view shows. */
export function useSelectedKey(): string | null {
  const route = useNav((s) => s.route);
  return route && 'branch' in route ? `${route.projectId}:${route.branch}` : null;
}

const ROLE_LABEL = { assigned: 'Assigned to', requested: 'Review requested from', opened: 'Opened by' } as const;

function peopleLabel(f: PeopleFilter) {
  if (f === 'anyone') return 'Anyone';
  const [role, ...who] = f.split(':') as [keyof typeof ROLE_LABEL, ...string[]];
  const name = who.join(':');
  return `${ROLE_LABEL[role]} ${name === 'me' ? 'me' : name}`;
}

/**
 * The full sidebar: the branches to review, grouped by what needs you first, as Switchboard groups its
 * sessions. A search and filters on top; Review another branch and Add project at the bottom.
 */
export function Sidebar({ data }: { data: SidebarData }) {
  const go = useNav((s) => s.go);
  const selected = useSelectedKey();
  const [folded, setFolded] = useState<Record<string, boolean>>({ reviewed: true, ignored: true });
  const mac = currentPlatform() === 'darwin';
  const total = data.groups.reduce((n, g) => n + (g.foldable ? 0 : g.rows.length), 0);

  const peopleOptions = [
    { value: 'anyone' as PeopleFilter, label: 'Anyone' },
    ...(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).flatMap((role) => ['me', ...data.everyone[role]].map((p) => ({ value: `${role}:${p}` as PeopleFilter, label: peopleLabel(`${role}:${p}`) }))),
  ];
  if (!peopleOptions.some((o) => o.value === data.people)) peopleOptions.push({ value: data.people, label: peopleLabel(data.people) });

  // ↑ and ↓ move through the rows, E ignores the focused one or brings it back; Enter opens it (it's a button).
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-branch-row]')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    if (matches(e.nativeEvent, 'sidebar.move')) {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (matches(e.nativeEvent, 'sidebar.ignore')) {
      e.preventDefault();
      const row = data.groups.flatMap((g) => g.rows).find((r) => r.key === rows[at]!.dataset.branchRow);
      if (row) void data.ignore(row, !row.ignored);
    }
  };

  return (
    <nav aria-label="Branches" className="flex h-full flex-col border-r border-border bg-sidebar">
      <div className={`drag flex h-13 shrink-0 items-center gap-1 pr-3 ${mac ? 'pl-24' : 'pl-3'}`}>
        <span className="flex-1" />
        <Button variant="quiet" iconOnly aria-label="Settings" shortcut="settings" icon={<Settings size={15} aria-hidden />} onClick={() => openSettings()} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-ui text-faint focus-within:border-accent-ink/60">
          <Search size={13} aria-hidden />
          <input
            id={SEARCH_ID}
            value={data.query}
            onChange={(e) => data.setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (data.setQuery(''), (e.target as HTMLInputElement).blur())}
            placeholder="Search branches"
            aria-label="Search branches"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-faint"
          />
          <Kbd shortcut="branch.goto" />
        </label>
        <div className="flex gap-1.5">
          <Select
            label="Project"
            value={data.project}
            onChange={data.setProject}
            options={[{ value: 'all', label: 'All projects' }, ...data.projects.map((p) => ({ value: p.id, label: p.name }))]}
            className={`${FIELD} min-w-0 flex-1`}
          />
          <Select label="People" value={data.people} onChange={data.setPeople} options={peopleOptions} className={`${FIELD} min-w-0 flex-1`} menuWidth={220} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onKeyDown={onListKey}>
        {!data.loaded && data.loading && <Loading label="Checking branches…" />}
        {data.error && (
          <Notice tone="error" className="mx-1">
            {data.error}
          </Notice>
        )}
        {data.loaded && total === 0 && (
          <Notice className="mx-1 my-2">{data.query || data.people !== 'anyone' ? 'Nothing matches.' : 'Nothing waiting for you.'}</Notice>
        )}
        {data.groups.map((g) =>
          g.rows.length === 0 ? null : (
            <Group key={g.id} group={g} folded={!!folded[g.id]} onFold={() => setFolded((f) => ({ ...f, [g.id]: !f[g.id] }))} selected={selected} onIgnore={data.ignore} />
          )
        )}
      </div>

      <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border p-3">
        <Button size="lg" shortcut="branch.other" className="w-full" onClick={() => go({ name: 'pick', projectId: data.project === 'all' ? undefined : data.project })}>
          Review another branch…
        </Button>
        <Button variant="quiet" icon={<Plus size={14} aria-hidden />} className="w-full" onClick={() => go({ name: 'connect' })}>
          Add project
        </Button>
      </footer>
    </nav>
  );
}

function Group({ group, folded, onFold, selected, onIgnore }: { group: BranchGroup; folded: boolean; onFold(): void; selected: string | null; onIgnore(row: BranchRow, on: boolean): void }) {
  return (
    <section className="pt-2" aria-label={group.label}>
      <SectionHeader count={group.rows.length} className="h-6 px-2" toggle={group.foldable ? { expanded: !folded, onToggle: onFold } : undefined}>
        {group.label}
      </SectionHeader>
      {!(group.foldable && folded) && (
        <ul className="m-0 flex list-none flex-col gap-px p-0">
          {group.rows.map((row) => (
            <Row key={row.key} row={row} selected={row.key === selected} onIgnore={onIgnore} canIgnore={group.id !== 'reviewed' && group.id !== 'sent'} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ row, selected, canIgnore, onIgnore }: { row: BranchRow; selected: boolean; canIgnore: boolean; onIgnore(row: BranchRow, on: boolean): void }) {
  return (
    <li className="group relative">
      <button
        type="button"
        data-branch-row={row.key}
        aria-current={selected ? 'page' : undefined}
        disabled={!!row.error}
        onClick={() => openRow(row)}
        data-tooltip={row.tooltip ?? undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-2 text-left disabled:opacity-60 ${selected ? 'bg-selected' : 'hover:bg-border/45'}`}
      >
        <ProjectIcon name={row.projectName} size={18} />
        <span className="grid min-w-0 flex-1">
          <span className={`truncate text-body ${row.unseen ? 'font-semibold text-text' : 'text-text'}`}>{row.title}</span>
          <span className="truncate text-meta text-faint">
            {row.error ? <span className="text-error">{row.error}</span> : row.meta}
            {row.problem && <span className="text-error"> · {row.problem}</span>}
          </span>
        </span>
        {row.working ? (
          <span className="working-dots self-start pt-2" aria-label="The agent is working">
            <span />
            <span />
            <span />
          </span>
        ) : (
          row.age && <span className={`self-start pt-1 text-meta text-faint ${canIgnore ? 'group-hover:invisible group-focus-within:invisible' : ''}`}>{row.age}</span>
        )}
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
          className="invisible absolute top-1.5 right-1.5 group-focus-within:visible group-hover:visible"
        />
      )}
    </li>
  );
}

