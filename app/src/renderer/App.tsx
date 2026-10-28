import { useEffect, useState } from 'react';
import { Welcome } from './screens/Welcome.tsx';
import { Connect } from './screens/Connect.tsx';
import { Home } from './screens/Home.tsx';
import { StartReview } from './screens/StartReview.tsx';
import { Review } from './screens/Review.tsx';
import { Finish } from './screens/Finish.tsx';
import { Done } from './screens/Done.tsx';
import { PickBranch } from './screens/PickBranch.tsx';
import { PlanScreen } from './screens/Plan.tsx';
import type { FinishResult, ReviewData, ReviewState } from '../shared/types.ts';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect'; path?: string; projectId?: string }
  | { name: 'pick'; projectId?: string }
  | { name: 'home' }
  | { name: 'start'; projectId: string; branch: string }
  | { name: 'plan'; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }
  | { name: 'review'; projectId: string; branch: string; stepKey?: string; preloaded?: { data: ReviewData; state: ReviewState }; reload?: number }
  | { name: 'finish'; projectId: string; branch: string }
  | { name: 'done'; projectId: string; branch: string; result: FinishResult };

export type Go = (r: Route) => void;

export function App() {
  const [route, setRoute] = useState<Route | null>(null);
  const [hasProjects, setHasProjects] = useState(false);

  useEffect(() => {
    window.api.listProjects().then((ps) => {
      setHasProjects(ps.length > 0);
      setRoute(ps.length ? { name: 'home' } : { name: 'welcome' });
    });
  }, []);

  const go: Go = (r) => {
    if (r.name === 'home') setHasProjects(true);
    setRoute(r);
    window.scrollTo(0, 0);
  };

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
      return <Home go={go} />;
    case 'start':
      return <StartReview go={go} projectId={route.projectId} branch={route.branch} />;
    case 'plan':
      return <PlanScreen key={`${route.projectId}:${route.branch}`} go={go} projectId={route.projectId} branch={route.branch} preloaded={route.preloaded} />;
    case 'review':
      // A new `reload` remounts the review, so it reads the branch again.
      return <Review key={route.reload} go={go} projectId={route.projectId} branch={route.branch} initialStep={route.stepKey} preloaded={route.preloaded} />;
    case 'finish':
      return <Finish go={go} projectId={route.projectId} branch={route.branch} />;
    case 'done':
      return <Done go={go} projectId={route.projectId} branch={route.branch} result={route.result} />;
  }
}
