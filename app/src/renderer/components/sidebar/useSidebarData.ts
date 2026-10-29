import { useEffect, useMemo, useState } from 'react';
import { matchesPeople, peopleLine, peopleOptions, type PeopleFilter } from '../../../shared/people.ts';
import type { InboxItem } from '../../../shared/types.ts';
import { useBranches } from '../../state/branches.ts';
import { useNav } from '../../state/nav.ts';
import { useAsync, useInbox, usePref } from '../ui.tsx';
import { branchGroups, type BranchRow } from './branchRows.ts';

/** Everything the sidebar and its rail show: the inbox in groups, the filters, and Ignore. Shared by both. */
export function useSidebarData() {
  const routeName = useNav((s) => s.route?.name);
  // Back from connecting or changing a project: read the list again.
  const settingsOpen = useNav((s) => s.settings);
  const projects = useAsync(() => window.api.listProjects(), [routeName, settingsOpen]);
  const inbox = useInbox();
  const [project, setProject] = usePref<string>('sidebar-project', 'all');
  const [people, setPeople] = usePref<PeopleFilter>('inbox-people', 'anyone');
  const [order] = usePref<'suggested' | 'newest'>('inbox-order', 'suggested');
  const [query, setQuery] = useState('');

  // Agents keep working while you review: refresh when the window comes back (at most every 30 seconds),
  // and always when an agent run ends.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      inbox.reload();
    };
    window.addEventListener('focus', onFocus);
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
  const names = useMemo(() => new Map(projects.value?.map((p) => [p.id, p.name])), [projects.value]);
  const filter = project === 'all' || !names.has(project) ? null : project;
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      branchGroups({
        waiting: inbox.value?.waiting ?? [],
        done: inbox.value?.done ?? [],
        projectNames: names,
        shown: (w: InboxItem) => (!filter || w.projectId === filter) && (!q || `${w.title} ${w.branch} ${w.projectName}`.toLowerCase().includes(q)) && matchesPeople(w, people, me),
        shownDone: (d) => (!filter || d.projectId === filter) && (!q || `${d.title} ${d.branch} ${names.get(d.projectId) ?? ''}`.toLowerCase().includes(q)),
        order,
        who: (w) => peopleLine(w, me),
      }),
    [inbox.value, names, filter, q, people, me, order]
  );

  // The order ⌃⇥ steps through, and what the closed sidebar's pill opens.
  useEffect(() => {
    const listed = groups.filter((g) => g.id !== 'ignored').flatMap((g) => g.rows);
    const review = groups.find((g) => g.id === 'review')!.rows;
    useBranches.getState().setOrder(
      listed.map((r) => ({ projectId: r.projectId, branch: r.branch })),
      review.length,
      review[0] ? { projectId: review[0].projectId, branch: review[0].branch } : null
    );
  }, [groups]);

  const ignore = async (row: BranchRow, on: boolean) => {
    // The list changes right away; the scan after it brings in the size and flags of a branch you bring back.
    inbox.patch((v) => ({ ...v, waiting: v.waiting.map((x) => (x.projectId === row.projectId && x.branch === row.branch ? { ...x, ignored: on } : x)) }));
    await window.api.ignoreBranch(row.projectId, row.branch, on);
    inbox.reload();
  };

  return {
    groups,
    projects: projects.value ?? [],
    scans: inbox.value?.scans ?? [],
    loading: inbox.loading,
    loaded: !!inbox.value,
    error: inbox.error,
    project: filter ?? 'all',
    setProject,
    people,
    setPeople,
    everyone: peopleOptions((inbox.value?.waiting ?? []).filter((w) => !w.ignored), me),
    query,
    setQuery,
    ignore,
  };
}

export type SidebarData = ReturnType<typeof useSidebarData>;
