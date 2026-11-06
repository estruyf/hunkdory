// Open reviews as tabs, like a browser's: the inbox stays first, and each branch you open gets one tab with
// its own history. Pure, so it can be tested without React; App holds the state.
import type { Route } from '../App.tsx';

export const INBOX = 'inbox';

export interface Tab {
  id: string;
  /** Every screen you went to in this tab, so back and forward work like in a browser. */
  stack: Route[];
  at: number;
}

export interface Tabs {
  tabs: Tab[];
  active: string;
  /** Back from a tab's first screen went to the inbox: forward returns to that tab. */
  cameFrom?: string;
  /** Tabs you closed, last one last, for ⌘⇧T: where you were in each, and where its tab stood. For this run only. */
  closed?: { route: Route; index: number }[];
}

/** As far back as ⌘⇧T goes. */
const MAX_CLOSED = 20;

/** Everything about a branch happens in that branch's tab; every other screen in the inbox's. */
export const tabId = (r: Route) => ('branch' in r ? `${r.projectId}::${r.branch}` : INBOX);
export const routeOf = (t: Tab) => t.stack[t.at]!;
export const startTabs = (first: Route): Tabs => ({ tabs: [{ id: INBOX, stack: [first], at: 0 }], active: INBOX });
export const activeRoute = (s: Tabs): Route | null => {
  const tab = find(s, s.active);
  return tab ? routeOf(tab) : null;
};

const find = (s: Tabs, id: string) => s.tabs.find((t) => t.id === id);
const withTab = (s: Tabs, tab: Tab): Tabs => ({ ...s, tabs: s.tabs.map((t) => (t.id === tab.id ? tab : t)) });

// A finished review can't be finished again: back from Done goes to the inbox.
const pushed = (t: Tab, r: Route): Tab => (r.name === 'done' ? { ...t, stack: [r], at: 0 } : { ...t, stack: [...t.stack.slice(0, t.at + 1), r], at: t.at + 1 });

/** Asking for a branch that's already open, or for the inbox, means going back to it as you left it. */
function keepsPlace(t: Tab, r: Route) {
  const at = routeOf(t);
  return (r.name === 'plan' && !r.preloaded) || (r.name === 'home' && at.name === 'home' && (!r.projectId || r.projectId === at.projectId));
}

/** Picking a branch is done with the list: the inbox tab goes back to the inbox. */
function pastPick(t: Tab): Tab {
  if (routeOf(t).name !== 'pick') return t;
  const at = t.stack.slice(0, t.at).findLastIndex((r) => r.name === 'home');
  return at < 0 ? { ...t, stack: [{ name: 'home' }], at: 0 } : { ...t, stack: t.stack.slice(0, at + 1), at };
}

export function activate(s: Tabs, id: string): Tabs {
  if (id === s.active || !find(s, id)) return s;
  const left = find(s, s.active);
  // Done has nothing to come back to: the tab goes when you leave it, and the inbox still lists the branch.
  return { ...s, tabs: left && routeOf(left).name === 'done' ? s.tabs.filter((t) => t !== left) : s.tabs, active: id, cameFrom: undefined };
}

/**
 * Goes to `r`, as asked from the tab `from`. A tab in the background that finishes something, like a merge,
 * moves on without taking over the screen, and can't send you anywhere else.
 */
export function navigate(s: Tabs, r: Route, from = s.active): Tabs {
  const id = tabId(r);
  const there = find(s, id);
  if (from !== s.active) return id === from && there ? withTab(s, pushed(there, r)) : s;
  if (id === s.active) return there ? { ...withTab(s, pushed(there, r)), cameFrom: undefined } : s;
  const inbox = find(s, INBOX);
  const base = id !== INBOX && s.active === INBOX && inbox ? withTab(s, pastPick(inbox)) : s;
  if (!there) return activate({ ...base, tabs: [...base.tabs, { id, stack: [r], at: 0 }] }, id);
  return activate(keepsPlace(there, r) ? base : withTab(base, pushed(there, r)), id);
}

/** Back or forward in the tab on screen. Past its first screen is the inbox, as when branches opened from there. */
export function move(s: Tabs, by: -1 | 1, freshen: (r: Route) => Route = (r) => r): Tabs {
  const tab = find(s, s.active);
  if (!tab) return s;
  const to = tab.at + by;
  if (tab.stack[to]) return withTab(s, { ...tab, stack: tab.stack.map((r, i) => (i === to ? freshen(r) : r)), at: to });
  if (by === -1 && s.active !== INBOX) {
    const back = activate(s, INBOX);
    return find(back, s.active) ? { ...back, cameFrom: s.active } : back;
  }
  if (by === 1 && s.active === INBOX && s.cameFrom) return activate(s, s.cameFrom);
  return s;
}

/** Closes a tab; the one to its right takes over, else the one to its left. The inbox stays. */
export function closeTab(s: Tabs, id: string): Tabs {
  const at = s.tabs.findIndex((t) => t.id === id);
  if (id === INBOX || at < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  const closed = [...(s.closed ?? []).filter((c) => tabId(c.route) !== id), ...place(routeOf(s.tabs[at]!)).map((route) => ({ route, index: at }))].slice(-MAX_CLOSED);
  return { ...s, tabs, active: s.active === id ? (tabs[at] ?? tabs[at - 1]!).id : s.active, cameFrom: s.cameFrom === id ? undefined : s.cameFrom, closed };
}

/** Brings back the tab closed last that isn't open again by now, where it stood, at the place you were. It reads its branch again. */
export function reopenTab(s: Tabs): Tabs {
  const closed = s.closed ?? [];
  const at = closed.findLastIndex((c) => !find(s, tabId(c.route)));
  if (at < 0) return s;
  const { route, index } = closed[at]!;
  const id = tabId(route);
  const tabs = [...s.tabs];
  tabs.splice(index, 0, { id, stack: [route], at: 0 });
  return activate({ ...s, tabs, closed: closed.slice(0, at) }, id);
}

/** The tab next to the one on screen, wrapping around. */
export function stepTab(s: Tabs, by: 1 | -1): string {
  const at = s.tabs.findIndex((t) => t.id === s.active);
  return s.tabs[(at + by + s.tabs.length) % s.tabs.length]!.id;
}

/** The tab at a position from 1, as a browser's ⌘1 to ⌘9: 9 is always the last one. */
export function tabAt(s: Tabs, n: number): string | null {
  return (n === 9 ? s.tabs.at(-1) : s.tabs[n - 1])?.id ?? null;
}

/** A project you removed takes its tabs with it. */
export function withoutProjectsGone(s: Tabs, projects: ReadonlySet<string>): Tabs {
  const gone = (r: Route) => 'projectId' in r && 'branch' in r && !projects.has(r.projectId);
  if (!s.tabs.some((t) => gone(routeOf(t))) && !s.closed?.some((c) => gone(c.route))) return s;
  const next = s.tabs.reduce((n, t) => (gone(routeOf(t)) ? closeTab(n, t.id) : n), s);
  return { ...next, closed: next.closed?.filter((c) => !gone(c.route)) };
}

const place = (r: Route): Route[] => {
  if (r.name === 'review') return [{ name: 'review', projectId: r.projectId, branch: r.branch, stepKey: r.stepKey, decision: r.decision, group: r.group, story: r.story }];
  // Finish starts from its form again, and a finished review has no tab to come back to.
  if (r.name === 'plan' || r.name === 'finish') return [{ name: 'plan', projectId: r.projectId, branch: r.branch }];
  return [];
};

/** What to remember between runs: the branches open, and where you were in each. The review's data is read again. */
export function savedTabs(s: Tabs) {
  const tabs = s.tabs.flatMap((t) => (t.id === INBOX ? [] : place(routeOf(t))));
  return { tabs, active: s.active };
}

const isPlace = (r: unknown): r is Extract<Route, { name: 'plan' | 'review' }> => {
  const x = r as { name?: unknown; projectId?: unknown; branch?: unknown } | null;
  return (x?.name === 'plan' || x?.name === 'review') && typeof x.projectId === 'string' && typeof x.branch === 'string';
};

/** The tabs from an earlier run, as far as their projects are still connected. What's saved may be from any version. */
export function restoreTabs(saved: unknown, projects: ReadonlySet<string>): Tabs {
  const { tabs, active } = (saved ?? {}) as { tabs?: unknown; active?: unknown };
  const open = new Map<string, Tab>();
  for (const r of Array.isArray(tabs) ? tabs : []) {
    if (isPlace(r) && projects.has(r.projectId)) open.set(tabId(r), { id: tabId(r), stack: [r], at: 0 });
  }
  const s = startTabs({ name: 'home' });
  return { tabs: [...s.tabs, ...open.values()], active: typeof active === 'string' && open.has(active) ? active : INBOX };
}
