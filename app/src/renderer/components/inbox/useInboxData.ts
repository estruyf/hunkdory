import { useEffect, useMemo, useState } from 'react';
import { matchesPeople, peopleLine, peopleOptions, type PeopleFilter } from '../../../shared/people.ts';
import type { InboxItem } from '../../../shared/types.ts';
import { useBranches } from '../../state/branches.ts';
import { useNav } from '../../state/nav.ts';
import { jobKey, useWalkthroughs } from '../../state/walkthroughs.ts';
import { useAsync, useInbox, usePref } from '../ui.tsx';
import { branchGroups, withWalkthroughs, type BranchRow } from './branchRows.ts';

/**
 * Everything the inbox shows: the branches in groups, the filters, and Ignore. App reads it once, so the
 * order ⌃⇥ steps through stays current on every screen, and hands it to Home.
 */
export function useInboxData() {
  const routeName = useNav((s) => s.route?.name);
  // Back from connecting or changing a project: read the list again.
  const settingsOpen = useNav((s) => s.settings);
  const projects = useAsync(() => window.api.listProjects(), [routeName, settingsOpen]);
  const inbox = useInbox();
  const [project, setProject] = usePref<string>('inbox-project', 'all');
  const [people, setPeople] = usePref<PeopleFilter>('inbox-people', 'anyone');
  const [order] = usePref<'suggested' | 'newest'>('inbox-order', 'suggested');
  const [query, setQuery] = useState('');
  const jobs = useWalkthroughs((s) => s.jobs);
  const ready = useWalkthroughs((s) => s.ready);

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
  const groups = useMemo(() => {
    const rows = branchGroups({
      waiting: inbox.value?.waiting ?? [],
      done: inbox.value?.done ?? [],
      projectNames: names,
      shown: (w: InboxItem) => (!filter || w.projectId === filter) && (!q || `${w.title} ${w.branch} ${w.projectName}`.toLowerCase().includes(q)) && matchesPeople(w, people, me),
      shownDone: (d) => (!filter || d.projectId === filter) && (!q || `${d.title} ${d.branch} ${names.get(d.projectId) ?? ''}`.toLowerCase().includes(q)),
      order,
      who: (w) => peopleLine(w, me),
    });
    // Walkthroughs go on being written while you're on another branch.
    return withWalkthroughs(rows, (row) => {
      const key = jobKey(row.projectId, row.branch);
      return jobs[key]?.status === 'running' ? 'writing' : ready[key] ? 'ready' : null;
    });
  }, [inbox.value, names, filter, q, people, me, order, jobs, ready]);

  // The order ⌃⇥ steps through, and what Open the first one opens.
  useEffect(() => {
    const listed = groups.filter((g) => g.id !== 'ignored').flatMap((g) => g.rows);
    const review = groups.find((g) => g.id === 'review')!.rows;
    // The first one you can open, from To review and then In progress: the hero counts both.
    const first = [...review, ...groups.find((g) => g.id === 'progress')!.rows].find((r) => !r.error);
    useBranches.getState().setOrder(
      listed.map((r) => ({ projectId: r.projectId, branch: r.branch })),
      review.length,
      first ? { projectId: first.projectId, branch: first.branch } : null
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
    /** Every branch the inbox read, before the filters. */
    waiting: inbox.value?.waiting ?? [],
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

export type InboxData = ReturnType<typeof useInboxData>;
