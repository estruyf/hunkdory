// The first read of a branch: the page you're about to get, in outline, with what's known about it already.
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Crumbs, knownInboxItem, sizeText } from './ui.tsx';
import { ViewHeader } from './ViewHeader.tsx';

/** A read that takes longer than this gets a word on why. */
const SLOW_MS = 4000;

const Bar = ({ className }: { className: string }) => <span className={`skeleton block ${className}`} />;

function Reading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <span role="status" className="flex items-center gap-2 text-ui text-muted">
      <Loader2 size={14} className="shrink-0 animate-spin text-accent-ink" aria-hidden />
      {slow ? 'Still reading. Checking GitHub or a big diff can take a few seconds.' : 'Reading the branch…'}
    </span>
  );
}

function PlanOutline({ meta }: { meta: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pt-7 pb-14">
      <div className="flex flex-col gap-2.5">
        {meta}
        <Bar className="h-8 w-3/5" />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Bar className="h-10 w-52 rounded-lg" />
          <Reading />
        </div>
      </div>
      <div aria-hidden className="grid grid-cols-[96px_1fr] items-center gap-x-5 gap-y-3.5 border-t border-border pt-5">
        {['w-3/4', 'w-11/12', 'w-1/2'].map((width) => (
          <div key={width} className="contents">
            <Bar className="h-3 w-20" />
            <Bar className={`h-4 ${width}`} />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-3 border-t border-border pt-5">
        <Bar className="h-3 w-24" />
        <Bar className="h-3.5 w-1/2" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
              <Bar className="h-5 w-20 rounded-full" />
              <Bar className="h-4 w-2/3" />
              <Bar className="h-3.5 w-11/12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The lengths of the lines in the outline of a diff. Fixed: it shouldn't change while you look at it.
const DIFF_LINES = ['w-1/3', 'w-1/2', 'w-2/5', 'w-3/5', 'w-1/4', 'w-1/2', 'w-2/3', 'w-1/3', 'w-2/5', 'w-1/2', 'w-1/5', 'w-3/5'];

function StepOutline({ meta }: { meta: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-7">
      <div className="flex flex-col gap-2.5">
        {meta}
        <Bar className="h-7 w-2/5" />
        <Bar className="h-4 w-3/4" />
        <Reading />
      </div>
      <div aria-hidden className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Bar className="h-3.5 w-1/3" />
        </div>
        <div className="flex flex-col gap-2.5 p-4">
          {DIFF_LINES.map((width, i) => (
            <Bar key={i} className={`h-3 ${width}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

const OUTLINES = { plan: PlanOutline, step: StepOutline };

/**
 * Full-view loading state, with the header the page will have, so the page doesn't jump when it's in.
 * The outline stays invisible for the first moments; most loads finish before it shows.
 */
export function LoadingPage({ shape, projectId, branch }: { shape: keyof typeof OUTLINES; projectId: string; branch: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);
  // The inbox already knows this much about a branch it lists.
  const known = knownInboxItem(projectId, branch);
  const Outline = OUTLINES[shape];
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        {known ? (
          <div className="min-w-0 flex-1">
            <Crumbs items={[{ label: known.projectName }, { label: known.title, shrink: true }]} />
          </div>
        ) : (
          <span className="truncate font-mono text-ui text-faint">{branch}</span>
        )}
      </ViewHeader>
      <div aria-busy className={`min-h-0 flex-1 overflow-hidden transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <Outline
          meta={
            <span className="flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
              <span className="font-mono font-semibold text-text">{branch}</span>
              {known && <span>· {sizeText(known.files, known.added, known.removed)}</span>}
            </span>
          }
        />
      </div>
    </div>
  );
}
