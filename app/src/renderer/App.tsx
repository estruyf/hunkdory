import { useEffect, useRef, useState } from 'react';
import { SidebarShell } from './components/sidebar/SidebarShell.tsx';
import { openSidebarSearch } from './components/sidebar/Sidebar.tsx';
import { ShortcutsSheet } from './components/shortcuts/ShortcutsSheet.tsx';
import { TooltipLayer } from './components/ui/Tooltip.tsx';
import { matches, type ShortcutContext } from './lib/shortcuts.ts';
import { stepBranch, useBranches } from './state/branches.ts';
import { openSettings, useNav } from './state/nav.ts';
import { useSidebar } from './state/sidebar.ts';
import { Welcome } from './screens/Welcome.tsx';
import { Connect } from './screens/Connect.tsx';
import { Home } from './screens/Home.tsx';
import { Review } from './screens/Review.tsx';
import { Finish } from './screens/Finish.tsx';
import { Done } from './screens/Done.tsx';
import { PickBranch } from './screens/PickBranch.tsx';
import { PlanScreen } from './screens/Plan.tsx';
import { Settings } from './screens/Settings.tsx';
import { rememberReview } from './components/ui.tsx';
import type { FinishResult, ReviewData, ReviewState } from '../shared/types.ts';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect'; path?: string; projectId?: string }
  | { name: 'pick'; projectId?: string }
  // `projectId` opens the inbox on that project.
  | { name: 'home'; projectId?: string }
  | { name: 'plan'; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }
  // `decision` is set while you go through the decisions: the step shown is the one the decision is about.
  // `group` shows a whole skim folder on one page.
  | { name: 'review'; projectId: string; branch: string; stepKey?: string; decision?: string; group?: string; preloaded?: { data: ReviewData; state: ReviewState }; reload?: number }
  | { name: 'finish'; projectId: string; branch: string }
  | { name: 'done'; projectId: string; branch: string; result: FinishResult };

export type Go = (r: Route) => void;

export function App() {
  // Every screen you went to, so the mouse's back and forward buttons work like in a browser.
  const [nav, setNav] = useState<{ stack: Route[]; at: number }>({ stack: [], at: -1 });
  const route = nav.stack[nav.at] ?? null;
  const [hasProjects, setHasProjects] = useState(false);
  const [sheet, setSheet] = useState<ShortcutContext | null>(null);
  const settings = useNav((s) => s.settings);
  // The newest state of each review. A screen you go back to may carry an older one.
  const latest = useRef(new Map<string, ReviewState>());

  useEffect(() => {
    window.api.listProjects().then((ps) => {
      setHasProjects(ps.length > 0);
      setNav({ stack: [ps.length ? { name: 'home' } : { name: 'welcome' }], at: 0 });
    });
    return window.events.onReviewStateChanged((r) => {
      latest.current.set(`${r.projectId}::${r.branch}`, r);
      rememberReview(r);
    });
  }, []);

  const go: Go = (r) => {
    if (r.name === 'home') setHasProjects(true);
    // A finished review can't be finished again: back from Done goes to the inbox.
    setNav((n) => (r.name === 'done' ? { stack: [{ name: 'home' }, r], at: 1 } : { stack: [...n.stack.slice(0, n.at + 1), r], at: n.at + 1 }));
  };

  const move = (by: -1 | 1) =>
    setNav((n) => {
      const at = n.at + by;
      const r = n.stack[at];
      if (!r) return n;
      const pre = (r.name === 'plan' || r.name === 'review') && r.preloaded;
      const fresh = pre ? latest.current.get(`${r.projectId}::${r.branch}`) : undefined;
      const stack = pre && fresh ? n.stack.map((x, i) => (i === at ? { ...r, preloaded: { ...pre, state: fresh } } : x)) : n.stack;
      return { stack, at };
    });

  // The shell reads where you are; while you review, the sidebar steps aside.
  useEffect(() => {
    useNav.setState({ go, route });
    useSidebar.getState().setReviewing(route?.name === 'review' || route?.name === 'finish');
  }, [route]);

  // The app's own shortcuts, from the registry: the same keys as Switchboard where they mean the same thing.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      move(e.button === 3 ? -1 : 1);
    };
    const onKey = (e: KeyboardEvent) => {
      const current = useNav.getState().route;
      const branch = current && 'branch' in current ? { projectId: current.projectId, branch: current.branch } : null;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (matches(e, 'shortcuts')) run(() => setSheet((s) => (s ? null : sheetContext(current))));
      else if (matches(e, 'sidebar.toggle')) run(() => !useSidebar.getState().reviewing && useSidebar.getState().toggle());
      else if (matches(e, 'home')) run(() => go({ name: 'home' }));
      else if (matches(e, 'settings')) run(() => openSettings(!useNav.getState().settings));
      else if (matches(e, 'branch.goto')) run(openSidebarSearch);
      else if (matches(e, 'branch.other')) run(() => go({ name: 'pick', projectId: branch?.projectId }));
      else if (matches(e, 'nav.back')) run(() => move(-1));
      else if (matches(e, 'nav.forward')) run(() => move(1));
      else if (matches(e, 'branch.next') || matches(e, 'branch.previous')) {
        const to = stepBranch(useBranches.getState().order, branch, matches(e, 'branch.next') ? 1 : -1);
        if (to) run(() => go({ name: 'plan', ...to }));
      }
    };
    window.addEventListener('mouseup', onMouse);
    window.addEventListener('keydown', onKey);
    const off = window.events.onNavigate((dir) => move(dir === 'back' ? -1 : 1));
    return () => {
      window.removeEventListener('mouseup', onMouse);
      window.removeEventListener('keydown', onKey);
      off();
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
  // First run: one focused view, no sidebar yet.
  if (route.name === 'welcome')
    return (
      <div className="flex h-full">
        <Welcome go={go} />
        {overlays}
      </div>
    );
  return (
    <div className="flex h-full">
      <SidebarShell />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {view(route, go, hasProjects)}
        {/* Settings covers only the view: the sidebar stays, and closing it leaves you where you were. */}
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
      </main>
      {overlays}
    </div>
  );
}

/** Where you are, for the shortcuts sheet: what works here. */
function sheetContext(route: Route | null): ShortcutContext {
  const el = document.activeElement;
  const focus = el?.closest('nav[aria-label="Branches"]') ? 'sidebar' : el?.closest('input, textarea, [contenteditable]') ? 'field' : 'other';
  const view: ShortcutContext['view'] = useNav.getState().settings ? 'settings' : !route ? 'home' : route.name;
  return { view, decision: route?.name === 'review' && !!route.decision, group: route?.name === 'review' && !!route.group, focus };
}

function view(route: Route, go: Go, hasProjects: boolean) {
  switch (route.name) {
    case 'welcome':
      return <Welcome go={go} />;
    case 'connect':
      return <Connect key={route.projectId ?? 'new'} go={go} initialPath={route.path} projectId={route.projectId} back={hasProjects ? { name: 'home' } : { name: 'welcome' }} />;
    case 'pick':
      return <PickBranch go={go} initialProject={route.projectId} />;
    case 'home':
      return <Home key={route.projectId ?? 'all'} go={go} initialProject={route.projectId} />;
    case 'plan':
      return <PlanScreen key={`${route.projectId}:${route.branch}`} go={go} projectId={route.projectId} branch={route.branch} preloaded={route.preloaded} />;
    case 'review':
      // A new `reload` remounts the review, so it reads the branch again.
      return <Review key={`${route.projectId}:${route.branch}:${route.reload ?? ''}`} go={go} projectId={route.projectId} branch={route.branch} stepKey={route.stepKey} decision={route.decision} group={route.group} preloaded={route.preloaded} />;
    case 'finish':
      return <Finish go={go} projectId={route.projectId} branch={route.branch} />;
    case 'done':
      return <Done go={go} projectId={route.projectId} branch={route.branch} result={route.result} />;
  }
}
