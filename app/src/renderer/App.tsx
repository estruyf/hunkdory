import { useEffect, useRef, useState } from 'react';
import { Welcome } from './screens/Welcome.tsx';
import { Connect } from './screens/Connect.tsx';
import { Home } from './screens/Home.tsx';
import { StartReview } from './screens/StartReview.tsx';
import { Review } from './screens/Review.tsx';
import { Finish } from './screens/Finish.tsx';
import { Done } from './screens/Done.tsx';
import { PickBranch } from './screens/PickBranch.tsx';
import { PlanScreen } from './screens/Plan.tsx';
import { rememberReview } from './components/ui.tsx';
import type { FinishResult, ReviewData, ReviewState } from '../shared/types.ts';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect'; path?: string; projectId?: string }
  | { name: 'pick'; projectId?: string }
  // `projectId` opens the inbox on that project.
  | { name: 'home'; projectId?: string }
  | { name: 'start'; projectId: string; branch: string }
  | { name: 'plan'; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }
  // `decision` is set while you go through the decisions: the step shown is the one the decision is about.
  | { name: 'review'; projectId: string; branch: string; stepKey?: string; decision?: string; preloaded?: { data: ReviewData; state: ReviewState }; reload?: number }
  | { name: 'finish'; projectId: string; branch: string }
  | { name: 'done'; projectId: string; branch: string; result: FinishResult };

export type Go = (r: Route) => void;

export function App() {
  // Every screen you went to, so the mouse's back and forward buttons work like in a browser.
  const [nav, setNav] = useState<{ stack: Route[]; at: number }>({ stack: [], at: -1 });
  const route = nav.stack[nav.at] ?? null;
  const [hasProjects, setHasProjects] = useState(false);
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
    window.scrollTo(0, 0);
  };

  const move = (by: -1 | 1) =>
    setNav((n) => {
      const at = n.at + by;
      const r = n.stack[at];
      if (!r) return n;
      const pre = (r.name === 'plan' || r.name === 'review') && r.preloaded;
      const fresh = pre ? latest.current.get(`${r.projectId}::${r.branch}`) : undefined;
      const stack = pre && fresh ? n.stack.map((x, i) => (i === at ? { ...r, preloaded: { ...pre, state: fresh } } : x)) : n.stack;
      window.scrollTo(0, 0);
      return { stack, at };
    });

  // Mouse buttons 4 and 5, Cmd+[ and Cmd+], and (from the main process) swipes and app commands.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      move(e.button === 3 ? -1 : 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || (e.key !== '[' && e.key !== ']')) return;
      e.preventDefault();
      move(e.key === '[' ? -1 : 1);
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

  // Reading the project list takes a few milliseconds: show the empty page, not a spinner.
  if (!route) return <div className="page" />;
  switch (route.name) {
    case 'welcome':
      return <Welcome go={go} />;
    case 'connect':
      return <Connect key={route.projectId ?? 'new'} go={go} initialPath={route.path} projectId={route.projectId} back={hasProjects ? { name: 'home' } : { name: 'welcome' }} />;
    case 'pick':
      return <PickBranch go={go} initialProject={route.projectId} />;
    case 'home':
      return <Home key={route.projectId ?? 'all'} go={go} initialProject={route.projectId} />;
    case 'start':
      return <StartReview go={go} projectId={route.projectId} branch={route.branch} />;
    case 'plan':
      return <PlanScreen key={`${route.projectId}:${route.branch}`} go={go} projectId={route.projectId} branch={route.branch} preloaded={route.preloaded} />;
    case 'review':
      // A new `reload` remounts the review, so it reads the branch again.
      return <Review key={`${route.projectId}:${route.branch}:${route.reload ?? ''}`} go={go} projectId={route.projectId} branch={route.branch} stepKey={route.stepKey} decision={route.decision} preloaded={route.preloaded} />;
    case 'finish':
      return <Finish go={go} projectId={route.projectId} branch={route.branch} />;
    case 'done':
      return <Done go={go} projectId={route.projectId} branch={route.branch} result={route.result} />;
  }
}
