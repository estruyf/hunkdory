// What helps you understand a change before and while you read it: how its parts connect, what behaves differently, and how to see it working.
import { useId, useMemo, useState } from 'react';
import { RiskPill, plural } from './ui.tsx';
import { Markdown } from './markdown.tsx';
import { Button } from './ui/Button.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { TextButton } from './ui/TextButton.tsx';
import { BOX, layoutDiagram } from '../../shared/diagram.ts';
import { OUTSIDE_HINT } from '../../shared/order.ts';
import { fileNames, stepsLabel } from '../../shared/plan.ts';
import type { BehaviourChange, ChangeDiagram, Dependent, RequestedItem, ReviewData, Step, TryItStep } from '../../shared/types.ts';

const writtenBy = (data: Pick<ReviewData, 'walkthrough'>) => (data.walkthrough === 'reviewer' ? 'Hunkdory’s reading of the change' : 'The agent’s account of the change');

/** What a step changes for the app or its callers. `brief` leaves the example for the step itself. */
export function BehaviourNote({ behaviour, brief = false }: { behaviour: BehaviourChange; brief?: boolean }) {
  const row = (label: string, text: string) => (
    <>
      <dt className="text-meta font-semibold tracking-wider text-faint uppercase">{label}</dt>
      <dd className="m-0 min-w-0 text-body break-words select-text">
        <Markdown text={text} />
      </dd>
    </>
  );
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-1">
      {row('Before', behaviour.before)}
      {row('Now', behaviour.after)}
      {behaviour.example && !brief && row('Example', behaviour.example)}
    </dl>
  );
}

/** A step's behaviour change and the code outside the diff that relies on it. Nothing when it has neither. */
export function StepEffects({ step }: { step: Step }) {
  if (!step.behaviour && !step.dependents.length) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {step.behaviour && (
        <div className="flex flex-col gap-1.5">
          <SectionHeader as="h2">What behaves differently</SectionHeader>
          <BehaviourNote behaviour={step.behaviour} />
        </div>
      )}
      {step.dependents.length > 0 && <Dependents dependents={step.dependents} />}
    </section>
  );
}

/** Closed at first: it's for when you wonder what else this could break, and it shouldn't push the diff down. */
function Dependents({ dependents }: { dependents: Dependent[] }) {
  return (
    <details className="flex flex-col gap-1.5">
      <summary className="cursor-pointer text-ui font-semibold">
        {plural(dependents.length, 'unchanged file relies', 'unchanged files rely')} on this
      </summary>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
        {dependents.map((d) => (
          <li key={d.path} className="flex flex-col text-ui break-words select-text">
            <span className="font-mono font-semibold break-all">{d.path}</span>
            <span className="text-muted">
              <Markdown text={d.what} />
            </span>
          </li>
        ))}
      </ul>
      <span className="mt-1.5 block text-meta text-faint">These files aren’t in the diff. Hunkdory checked they exist, not how they use this.</span>
    </details>
  );
}

const STATUS: Record<RequestedItem['status'], { label: string; tone: string; hint: string }> = {
  done: { label: 'Code found', tone: 'text-ok', hint: 'The walkthrough found code for this. That doesn’t mean it works: check it in the step.' },
  partly: { label: 'Partly', tone: 'text-caution', hint: 'The walkthrough found code for some of this.' },
  missing: { label: 'Not found', tone: 'text-caution', hint: 'The walkthrough found no code for this. It may have looked in the wrong place.' },
};

/** "You asked" for a prompt, "The PR says" for a PR description: the same words on every screen. */
export const askedLabel = (data: Pick<ReviewData, 'prompt' | 'pr'>) => (data.prompt ? 'You asked' : data.pr ? 'The PR says' : 'The request');

/** One row of a list of things with a status: the status in colour, what it's about, and a way to the steps. */
function StatusRow({ status, tone, hint, children, note, steps, onOpen }: { status: string; tone: string; hint?: string; children: React.ReactNode; note?: React.ReactNode; steps: Step[]; onOpen: (step: Step) => void }) {
  return (
    <li className="grid grid-cols-[84px_minmax(0,1fr)_max-content] items-baseline gap-x-3 gap-y-0.5 border-t border-border py-2.5">
      <span className={`text-meta font-semibold ${tone}`} data-tooltip={hint}>
        {status}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="break-words select-text">{children}</span>
        {note && <span className="text-ui break-words text-muted select-text">{note}</span>}
      </span>
      {steps.length ? (
        <TextButton className="text-ui" onClick={() => onOpen(steps[0])}>
          {stepsLabel(steps.map((s) => s.index))} →
        </TextButton>
      ) : (
        <span />
      )}
    </li>
  );
}

/** Each thing the request asked for and where the change has code for it, then what it did that nobody asked for. */
export function RequestedList({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  const outside = data.steps.filter((s) => s.outsideTask);
  return (
    <ul className="m-0 flex list-none flex-col p-0 text-body">
      {data.requested.map((r, i) => {
        const status = STATUS[r.status];
        return (
          <StatusRow key={i} status={status.label} tone={status.tone} hint={status.hint} note={r.note} steps={r.stepKeys.flatMap((k) => data.steps.find((s) => s.key === k) ?? [])} onOpen={onOpen}>
            {r.item}
          </StatusRow>
        );
      })}
      {outside.map((s) => (
        <StatusRow key={s.key} status="Not asked" tone="text-muted" hint={OUTSIDE_HINT} note={fileNames(s.files) === s.title ? null : fileNames(s.files)} steps={[s]} onOpen={onOpen}>
          {s.title}
        </StatusRow>
      ))}
    </ul>
  );
}

function BoxText({ node, steps }: { node: ChangeDiagram['nodes'][number]; steps: Step[] }) {
  const high = steps.some((s) => s.risk === 'high');
  const detail = [node.kind, node.unchanged ? 'no changes' : plural(node.files.length, 'file')].filter(Boolean).join(' · ');
  return (
    <>
      <span className="line-clamp-2 text-ui font-semibold break-words text-text">{node.label}</span>
      <span className="truncate text-meta text-muted">{detail}</span>
      {(steps.length > 0 || high) && (
        <span className="mt-auto flex items-center justify-between gap-1.5 text-meta">
          {steps.length > 0 && <span className="truncate text-link">{steps.length > 1 ? 'Steps' : 'Step'} {steps.map((s) => s.index + 1).join(', ')}</span>}
          {high && <RiskPill risk="high" />}
        </span>
      )}
    </>
  );
}

/** How the parts of the change connect. A box opens the first step that changes it. */
export function DiagramView({ diagram, steps, onOpen, summary = true }: { diagram: ChangeDiagram; steps: Step[]; onOpen: (step: Step) => void; summary?: boolean }) {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram]);
  // Its own per diagram: a tab in the background can hold the same one, and an arrowhead defined in a hidden tab doesn't draw.
  const arrowId = `diagram-arrow-${useId().replace(/\W/g, '')}`;
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const stepsOf = (keys: string[]) => keys.flatMap((k) => steps.find((s) => s.key === k) ?? []);
  return (
    <div className="flex flex-col gap-2">
      {summary && diagram.summary && <p className="m-0 text-body select-text">{diagram.summary}</p>}
      <div className="overflow-x-auto py-1">
        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
          <svg aria-hidden className="absolute inset-0 text-faint" width={layout.width} height={layout.height}>
            <defs>
              <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
              </marker>
            </defs>
            {layout.arrows.map((a, i) => (
              <path key={i} d={a.path} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${arrowId})`} />
            ))}
          </svg>
          {layout.arrows.map(
            (a, i) =>
              a.label && (
                <span
                  key={i}
                  aria-hidden
                  data-tooltip={a.label}
                  className="absolute max-w-40 -translate-x-1/2 -translate-y-1/2 truncate rounded bg-card px-1.5 text-meta text-muted"
                  style={{ left: a.labelX, top: a.labelY }}
                >
                  {a.label}
                </span>
              )
          )}
          {layout.boxes.map((b) => {
            const node = nodes.get(b.id)!;
            const boxSteps = stepsOf(node.stepKeys);
            const style = { left: b.x, top: b.y, width: BOX.width, height: BOX.height };
            const look = 'absolute flex flex-col gap-0.5 rounded-lg border bg-bg p-2.5 text-left';
            const files = node.files.join('\n');
            return boxSteps.length ? (
              <button key={b.id} type="button" style={style} data-tooltip={files} onClick={() => onOpen(boxSteps[0])} className={`${look} border-border hover:bg-border/45`}>
                <BoxText node={node} steps={boxSteps} />
              </button>
            ) : (
              <div key={b.id} style={style} data-tooltip={files} className={`${look} border-dashed ${node.unchanged ? 'border-faint' : 'border-border'}`}>
                <BoxText node={node} steps={boxSteps} />
              </div>
            );
          })}
        </div>
      </div>
      {/* The arrows are drawn, so a screen reader gets them in words. */}
      <ul className="sr-only">
        {diagram.edges.map((e, i) => (
          <li key={i}>
            {nodes.get(e.from)!.label} connects to {nodes.get(e.to)!.label}
            {e.label ? `: ${e.label}` : ''}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-faint">
        {diagram.nodes.some((n) => n.unchanged) && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-4 rounded-sm border border-dashed border-faint" /> Existing code, no changes
          </span>
        )}
        <span>Hunkdory checked the boxes against the diff. The arrows are the walkthrough’s reading of the code, so they can be wrong.</span>
      </div>
    </div>
  );
}

function TryItList({ steps }: { steps: TryItStep[] }) {
  return (
    <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-body">
      {steps.map((t, i) => (
        <li key={i} className="break-words select-text">
          <Markdown text={t.do} />
          {t.expect && (
            <div className="text-ui text-muted">
              <Markdown text={`You should see: ${t.expect}`} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

const CHANGES_SHOWN = 5;

/** The top of an "Understand" page: where you are, what it's about, and in one sentence what's on it. */
export function UnderstandHeader({ title, summary }: { title: string; summary: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-meta font-semibold tracking-wider text-faint uppercase">Before you read</span>
      <h1 className="text-hero font-semibold break-words">{title}</h1>
      {summary && <p className="text-body text-muted select-text">{summary}</p>}
    </div>
  );
}

/** What was asked, item by item, and what the change did besides. */
export function AskedPage({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  return (
    <>
      <RequestedList data={data} onOpen={onOpen} />
      {data.requested.length > 0 && <span className="text-meta text-faint">The walkthrough matched each ask to code. Check that the code works in its step.</span>}
    </>
  );
}

/** What to know first, and how the parts of the change connect. */
export function FitsPage({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  return (
    <>
      {data.background && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
          <SectionHeader as="h2">To know first</SectionHeader>
          <div className="text-body select-text">
            <Markdown text={data.background} />
          </div>
        </div>
      )}
      {data.diagram && (
        <div className="border-t border-border pt-4">
          <DiagramView diagram={data.diagram} steps={data.steps} onOpen={onOpen} summary={false} />
        </div>
      )}
    </>
  );
}

/** What each step changes for the app or its callers, then how to see it working. */
export function TryPage({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  const [all, setAll] = useState(false);
  const changes = data.steps.filter((s) => s.behaviour);
  const shown = all ? changes : changes.slice(0, CHANGES_SHOWN);
  const both = changes.length > 0 && data.tryIt.length > 0;
  return (
    <>
      {changes.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {both && <SectionHeader as="h2">What behaves differently</SectionHeader>}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {shown.map((s) => (
              <li key={s.key} className="flex flex-col gap-1">
                <TextButton className="self-start text-ui font-semibold break-words" onClick={() => onOpen(s)}>
                  Step {s.index + 1}: {s.title} →
                </TextButton>
                <BehaviourNote behaviour={s.behaviour!} brief />
              </li>
            ))}
          </ul>
          {changes.length > shown.length && (
            <Button variant="quiet" className="self-start" onClick={() => setAll(true)}>
              Show {changes.length - shown.length} more
            </Button>
          )}
        </div>
      )}
      {data.tryIt.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {both && <SectionHeader as="h2">How to try it</SectionHeader>}
          <TryItList steps={data.tryIt} />
        </div>
      )}
      <span className="text-meta text-faint">{writtenBy(data)}, not run or checked against the running app.</span>
    </>
  );
}
