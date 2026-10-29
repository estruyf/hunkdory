import { useEffect } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, Loading, plural, useAsync, useInbox } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { ProjectIcon } from '../components/ProjectIcon.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { formatDuration } from '../../shared/order.ts';
import { matches } from '../lib/shortcuts.ts';
import { useBranches } from '../state/branches.ts';
import type { Project, ProjectScan } from '../../shared/types.ts';

/**
 * The view when no branch is open: what waits for you across your projects, and why a project has nothing.
 * The branches themselves are in the sidebar; ⌘↵ opens the first one to review.
 */
export function Home({ go, initialProject }: { go: Go; initialProject?: string }) {
  const projects = useAsync(() => window.api.listProjects(), []);
  const inbox = useInbox();
  const first = useBranches((s) => s.firstToReview);
  const waiting = (inbox.value?.waiting ?? []).filter((w) => !w.ignored && w.review?.status !== 'sent-back' && (!initialProject || w.projectId === initialProject));
  const minutes = waiting.reduce((n, w) => n + w.minutes, 0);
  const shown = (projects.value ?? []).filter((p) => !initialProject || p.id === initialProject);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!first || !matches(e, 'home.open')) return;
      e.preventDefault();
      go({ name: 'plan', ...first });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[{ label: shown.length === 1 && initialProject ? shown[0]!.name : 'Inbox' }]} />
        </div>
      </ViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-14 pb-14">
          {!inbox.value && inbox.loading ? (
            <Loading label="Checking agent branches…" />
          ) : (
            <div className="flex flex-col gap-2">
              <h1 className="text-hero font-semibold">{waiting.length ? `${plural(waiting.length, 'branch', 'branches')} waiting for your review` : 'Nothing waiting for your review'}</h1>
              <p className="text-body text-muted">
                {waiting.length
                  ? `About ${formatDuration(minutes)} in all. The sidebar lists them in the order to take them: reviews you started, then what changed since your review, then the smallest first.`
                  : 'Agents keep working while you look away: new branches show up in the sidebar as they come in.'}
              </p>
              {first && waiting.length > 0 && (
                <div className="pt-2">
                  <Button variant="primary" size="lg" shortcut="home.open" onClick={() => go({ name: 'plan', ...first })}>
                    Open the first one
                  </Button>
                </div>
              )}
            </div>
          )}
          {inbox.error && <Notice tone="error">{inbox.error}</Notice>}

          {shown.length > 0 && (
            <section className="flex flex-col gap-1">
              <SectionHeader as="h2" count={shown.length}>
                Projects
              </SectionHeader>
              <ul className="m-0 flex list-none flex-col gap-px p-0">
                {shown.map((p) => (
                  <ProjectRow key={p.id} project={p} scan={inbox.value?.scans.find((x) => x.projectId === p.id)} waiting={waiting.filter((w) => w.projectId === p.id).length} go={go} />
                ))}
              </ul>
            </section>
          )}
          <p className="flex flex-wrap items-center gap-1.5 text-meta text-faint">
            <Kbd shortcut="branch.goto" /> go to a branch · <Kbd shortcut="sidebar.toggle" /> sidebar · <Kbd shortcut="shortcuts" /> every shortcut
          </p>
        </div>
      </div>
    </div>
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
