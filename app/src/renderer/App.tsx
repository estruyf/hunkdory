import { useEffect, useRef, useState } from 'react';
import { useInboxData, type InboxData } from './components/inbox/useInboxData.ts';
import { ShortcutsSheet } from './components/shortcuts/ShortcutsSheet.tsx';
import { TabStrip } from './components/TabStrip.tsx';
import { TooltipLayer } from './components/ui/Tooltip.tsx';
import { matches, type ShortcutContext } from './lib/shortcuts.ts';
import { stepBranch, useBranches } from './state/branches.ts';
import { openSettings, useNav } from './state/nav.ts';
import { TabPane } from './state/tabPane.ts';
import { activate, activeRoute, closeTab, INBOX, move, navigate, reopenTab, restoreTabs, routeOf, savedTabs, startTabs, stepTab, tabAt, withoutProjectsGone, type Tabs } from './state/tabs.ts';
import { jobKey, useWalkthroughs, watchWalkthroughs } from './state/walkthroughs.ts';
import { rememberReadState } from './state/reviewReads.ts';
import { Welcome } from './screens/Welcome.tsx';
import { Connect } from './screens/Connect.tsx';
import { focusInboxSearch, Home } from './screens/Home.tsx';
import { Review } from './screens/Review.tsx';
import { Finish } from './screens/Finish.tsx';
import { Done } from './screens/Done.tsx';
import { PickBranch } from './screens/PickBranch.tsx';
import { PlanScreen } from './screens/Plan.tsx';
import { Settings } from './screens/Settings.tsx';
import { rememberReview } from './components/ui.tsx';
import type { FinishResult, ReviewData, ReviewState } from '../shared/types.ts';
import type { LineRef } from './components/diff.tsx';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect'; path?: string; projectId?: string }
  | { name: 'pick'; projectId?: string }
  // `projectId` opens the inbox on that project.
  | { name: 'home'; projectId?: string }
  | { name: 'plan'; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }
  // `decision` is set while you go through the decisions: the step shown is the one the decision is about.
  // `group` shows a whole skim folder on one page.
  | { name: 'review'; projectId: string; branch: string; stepKey?: string; decision?: string; group?: string; preloaded?: { data: ReviewData; state: ReviewState }; reload?: number; focus?: LineRef }
  | { name: 'finish'; projectId: string; branch: string }
  | { name: 'done'; projectId: string; branch: string; result: FinishResult; stack?: ReviewData['stack'] };

export type Go = (r: Route) => void;

const SAVED_TABS = 'open-tabs';

function readSavedTabs(): unknown {
  try {
    return JSON.parse(localStorage.getItem(SAVED_TABS) ?? 'null');
  } catch {
    return null;
  }
}

/** A dialog or menu has the keys until it's closed: leaving its tab would keep it open, out of sight. */
const modalOpen = () => document.querySelector('[aria-modal="true"], [data-popover]') !== null;

export function App() {
  // The open tabs, each with every screen you went to, so the mouse's back and forward buttons work like in a browser.
  const [nav, setNav] = useState<Tabs>({ tabs: [], active: INBOX });
  const tabsNow = useRef(nav);
  tabsNow.current = nav;
  const route = activeRoute(nav);
  // Tabs from an earlier run wait until you open them: each one reads its branch and may write a walkthrough.
  const visited = useRef(new Set<string>());
  visited.current.add(nav.active);
  const [hasProjects, setHasProjects] = useState(false);
  const [sheet, setSheet] = useState<ShortcutContext | null>(null);
  const settings = useNav((s) => s.settings);
  // The newest state of each review. A screen you go back to may carry an older one.
  const latest = useRef(new Map<string, ReviewState>());
  // Read here rather than in Home, so the order branches step through stays current on every screen.
  const inbox = useInboxData();

  useEffect(() => {
    window.api.listProjects().then((ps) => {
      setHasProjects(ps.length > 0);
      setNav(ps.length ? restoreTabs(readSavedTabs(), new Set(ps.map((p) => p.id))) : startTabs({ name: 'welcome' }));
    });
    return window.events.onReviewStateChanged((r) => {
      latest.current.set(`${r.projectId}::${r.branch}`, r);
      rememberReview(r);
      rememberReadState(r);
    });
  }, []);

  // Waiting on someone can take days: the tabs come back when Hunkdory does.
  useEffect(() => {
    if (!nav.tabs.length) return;
    try {
      localStorage.setItem(SAVED_TABS, JSON.stringify(savedTabs(nav)));
    } catch {
      // Storage full or blocked: the tabs last until you quit.
    }
  }, [nav]);

  useEffect(() => {
    if (inbox.projects.length) setNav((n) => withoutProjectsGone(n, new Set(inbox.projects.map((p) => p.id))));
  }, [inbox.projects]);

  const goFrom =
    (from?: string): Go =>
    (r) => {
      if (r.name === 'home') setHasProjects(true);
      setNav((n) => navigate(n, r, from ?? n.active));
    };
  const go = goFrom();

  /** A screen you go back to: with the newest state, or read again when a walkthrough finished since. */
  const freshen = (r: Route): Route => {
    if ((r.name !== 'plan' && r.name !== 'review') || !r.preloaded) return r;
    // A walkthrough finished since you were here: read the branch again rather than show one step per file.
    if (r.preloaded.data.walkthrough === 'skeleton' && useWalkthroughs.getState().jobs[jobKey(r.projectId, r.branch)]?.status === 'done') {
      const { preloaded: _stale, ...again } = r;
      return again;
    }
    const fresh = latest.current.get(`${r.projectId}::${r.branch}`);
    return fresh ? { ...r, preloaded: { ...r.preloaded, state: fresh } } : r;
  };
  const step = (by: -1 | 1) => {
    if (!modalOpen()) setNav((n) => move(n, by, freshen));
  };
  const switchTo = (pick: (n: Tabs) => string | null) => {
    openSettings(false);
    setNav((n) => {
      const id = pick(n);
      return id ? activate(n, id) : n;
    });
  };
  const closeCurrent = () => {
    if (useNav.getState().settings) return openSettings(false);
    if (modalOpen()) return;
    // The inbox has no tab to close: ⌘W closes the window, as it always did.
    if (tabsNow.current.active === INBOX) void window.api.closeWindow();
    else setNav((n) => closeTab(n, n.active));
  };

  // The shell reads where you are.
  useEffect(() => {
    useNav.setState({ go, route, tabs: hasProjects });
    if (route && 'branch' in route) useWalkthroughs.getState().seen(route.projectId, route.branch);
  }, [route, hasProjects]);

  // Walkthroughs keep being written while you're elsewhere; "Walkthrough ready" notifications open their branch.
  useEffect(() => {
    const stop = watchWalkthroughs();
    const off = window.events.onOpenBranch((to) => useNav.getState().go({ name: 'plan', ...to }));
    return () => {
      stop();
      off();
    };
  }, []);

  // The app's own shortcuts, from the registry: the same keys as Switchboard where they mean the same thing.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      step(e.button === 3 ? -1 : 1);
    };
    const onKey = (e: KeyboardEvent) => {
      const current = useNav.getState().route;
      const branch = current && 'branch' in current ? { projectId: current.projectId, branch: current.branch } : null;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (matches(e, 'shortcuts')) run(() => setSheet((s) => (s ? null : sheetContext(current))));
      else if (matches(e, 'settings')) run(() => openSettings(!useNav.getState().settings));
      else if (modalOpen()) return;
      else if (matches(e, 'home')) run(() => go({ name: 'home' }));
      else if (matches(e, 'branch.goto')) run(focusInboxSearch);
      else if (matches(e, 'branch.other')) run(() => go({ name: 'pick', projectId: branch?.projectId }));
      else if (matches(e, 'nav.back')) run(() => step(-1));
      else if (matches(e, 'nav.forward')) run(() => step(1));
      else if (matches(e, 'tab.reopen')) {
        run(() => {
          openSettings(false);
          setNav(reopenTab);
        });
      } else if (matches(e, 'tab.next') || matches(e, 'tab.previous')) run(() => switchTo((n) => stepTab(n, matches(e, 'tab.next') ? 1 : -1)));
      // On Connect these keys pick a repo.
      else if (matches(e, 'tab.goto') && current?.name !== 'connect' && current?.name !== 'welcome') run(() => switchTo((n) => tabAt(n, Number(e.key))));
      else if (matches(e, 'branch.next') || matches(e, 'branch.previous')) {
        const to = stepBranch(useBranches.getState().order, branch, matches(e, 'branch.next') ? 1 : -1);
        if (to) run(() => go({ name: 'plan', ...to }));
      }
    };
    window.addEventListener('mouseup', onMouse);
    window.addEventListener('keydown', onKey);
    const off = window.events.onNavigate((dir) => step(dir === 'back' ? -1 : 1));
    const offClose = window.events.onCloseTab(closeCurrent);
    return () => {
      window.removeEventListener('mouseup', onMouse);
      window.removeEventListener('keydown', onKey);
      off();
      offClose();
    };
  }, []);

  // Reading the project list takes a few milliseconds: show the empty window, not a spinner.
  if (!route) return <div className="h-full" />;
  const overlays = (
    <>
      <TooltipLayer />
      {sheet && <ShortcutsSheet ctx={sheet} onClose={() => setSheet(null)} />}
    </>
  );
  // First run: one focused view.
  if (route.name === 'welcome')
    return (
      <div className="flex h-full">
        <Welcome go={go} />
        {overlays}
      </div>
    );
  return (
    <main className="relative flex h-full min-w-0 flex-col">
      {hasProjects && <TabStrip tabs={nav.tabs} active={nav.active} inbox={inbox} onPick={(id) => switchTo(() => id)} onClose={(id) => setNav((n) => closeTab(n, id))} />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {nav.tabs
          .filter((tab) => visited.current.has(tab.id))
          .map((tab) => (
            <TabPane key={tab.id} value={tab.id === nav.active}>
              <div data-tab-active={tab.id === nav.active || undefined} className={tab.id === nav.active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                {view(routeOf(tab), goFrom(tab.id), hasProjects, inbox)}
              </div>
            </TabPane>
          ))}
        {/* Settings covers the view, and closing it leaves you where you were. */}
        {settings && (
          <div className="absolute inset-0 z-20 flex bg-bg">
            <Settings
              go={(r) => {
                openSettings(false);
                go(r);
              }}
              onClose={() => openSettings(false)}
            />
          </div>
        )}
      </div>
      {overlays}
    </main>
  );
}

/** Where you are, for the shortcuts sheet: what works here. */
function sheetContext(route: Route | null): ShortcutContext {
  const el = document.activeElement;
  const focus = el?.closest('[data-inbox-list]') ? 'list' : el?.closest('input, textarea, [contenteditable]') ? 'field' : 'other';
  const view: ShortcutContext['view'] = useNav.getState().settings ? 'settings' : !route ? 'home' : route.name;
  return { view, decision: route?.name === 'review' && !!route.decision, group: route?.name === 'review' && !!route.group, focus };
}

function view(route: Route, go: Go, hasProjects: boolean, inbox: InboxData) {
  switch (route.name) {
    case 'welcome':
      return <Welcome go={go} />;
    case 'connect':
      return <Connect key={route.projectId ?? 'new'} go={go} initialPath={route.path} projectId={route.projectId} back={hasProjects ? { name: 'home' } : { name: 'welcome' }} />;
    case 'pick':
      return <PickBranch go={go} initialProject={route.projectId} />;
    case 'home':
      return <Home key={route.projectId ?? 'all'} go={go} data={inbox} initialProject={route.projectId} />;
    case 'plan':
      return <PlanScreen key={`${route.projectId}:${route.branch}`} go={go} projectId={route.projectId} branch={route.branch} preloaded={route.preloaded} />;
    case 'review':
      // A new `reload` remounts the review, so it reads the branch again.
      return <Review key={`${route.projectId}:${route.branch}:${route.reload ?? ''}`} go={go} projectId={route.projectId} branch={route.branch} stepKey={route.stepKey} decision={route.decision} group={route.group} focus={route.focus} preloaded={route.preloaded} />;
    case 'finish':
      return <Finish go={go} projectId={route.projectId} branch={route.branch} />;
    case 'done':
      return <Done go={go} projectId={route.projectId} branch={route.branch} result={route.result} stack={route.stack ?? null} />;
  }
}
