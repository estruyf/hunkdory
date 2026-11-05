// What helps you understand a change before and while you read it: how its parts connect, what behaves differently, and how to see it working.
import { useId, useMemo, useState } from 'react';
import { RiskPill, plural } from './ui.tsx';
import { Markdown } from './markdown.tsx';
import { Button } from './ui/Button.tsx';
import { Pill } from './ui/Pill.tsx';
import type { PillTone } from './ui/buttonStyles.ts';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { SegmentedControl } from './ui/SegmentedControl.tsx';
import { BOX, layoutDiagram } from '../../shared/diagram.ts';
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

const STATUS: Record<RequestedItem['status'], { label: string; tone: PillTone; hint: string }> = {
  done: { label: 'Code found', tone: 'muted', hint: 'The walkthrough found code for this. That doesn’t mean it works: check it in the step.' },
  partly: { label: 'Partly', tone: 'default', hint: 'The walkthrough found code for some of this.' },
  missing: { label: 'Not found', tone: 'caution', hint: 'The walkthrough found no code for this. It may have looked in the wrong place.' },
};

/** Each thing the request asked for, and where the change has code for it. */
export function RequestedList({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {data.requested.map((r, i) => {
        const steps = r.stepKeys.flatMap((k) => data.steps.find((s) => s.key === k) ?? []);
        const status = STATUS[r.status];
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Pill tone={status.tone} data-tooltip={status.hint}>
              {status.label}
            </Pill>
            <span className="min-w-0 break-words select-text">{r.item}</span>
            {steps.map((s) => (
              <button key={s.key} type="button" className="text-ui text-link hover:underline" onClick={() => onOpen(s)}>
                Step {s.index + 1} →
              </button>
            ))}
            {r.note && <span className="w-full text-ui text-muted select-text">{r.note}</span>}
          </li>
        );
      })}
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
export function DiagramView({ diagram, steps, onOpen }: { diagram: ChangeDiagram; steps: Step[]; onOpen: (step: Step) => void }) {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram]);
  // Its own per diagram: a tab in the background can hold the same one, and an arrowhead defined in a hidden tab doesn't draw.
  const arrowId = `diagram-arrow-${useId().replace(/\W/g, '')}`;
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const stepsOf = (keys: string[]) => keys.flatMap((k) => steps.find((s) => s.key === k) ?? []);
  return (
    <div className="flex flex-col gap-2">
      {diagram.summary && <p className="m-0 text-body select-text">{diagram.summary}</p>}
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

type Tab = 'map' | 'behaviour' | 'try';
const CHANGES_SHOWN = 5;

/** The change as a whole, one view at a time so the plan stays short. Nothing when the walkthrough has none of it. */
export function ChangeOverview({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  const changes = data.steps.filter((s) => s.behaviour);
  const tabs: { value: Tab; label: string }[] = [
    ...(data.diagram ? [{ value: 'map' as const, label: 'How it fits together' }] : []),
    ...(changes.length ? [{ value: 'behaviour' as const, label: 'What behaves differently' }] : []),
    ...(data.tryIt.length ? [{ value: 'try' as const, label: 'How to try it' }] : []),
  ];
  const [picked, setPicked] = useState<Tab | null>(null);
  const [allChanges, setAllChanges] = useState(false);
  if (!tabs.length) return null;
  const changesShown = allChanges ? changes : changes.slice(0, CHANGES_SHOWN);
  const tab = tabs.some((t) => t.value === picked) ? picked! : tabs[0].value;
  return (
    <section aria-label="Understand the change" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {tabs.length > 1 ? (
        <SegmentedControl<Tab> mode="radio" label="View" size="sm" className="self-start" value={tab} onChange={setPicked} segments={tabs} />
      ) : (
        <SectionHeader as="h2">{tabs[0].label}</SectionHeader>
      )}
      {tab === 'map' && data.diagram && <DiagramView diagram={data.diagram} steps={data.steps} onOpen={onOpen} />}
      {tab === 'behaviour' && (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {changesShown.map((s) => (
              <li key={s.key} className="flex flex-col gap-1">
                <button type="button" className="self-start text-left text-ui font-semibold break-words text-link hover:underline" onClick={() => onOpen(s)}>
                  Step {s.index + 1}: {s.title} →
                </button>
                <BehaviourNote behaviour={s.behaviour!} brief />
              </li>
            ))}
          </ul>
          {changes.length > changesShown.length && (
            <Button variant="quiet" className="self-start" onClick={() => setAllChanges(true)}>
              Show {changes.length - changesShown.length} more
            </Button>
          )}
        </>
      )}
      {tab === 'try' && <TryItList steps={data.tryIt} />}
      {tab !== 'map' && <span className="text-meta text-faint">{writtenBy(data)}, not run or checked against the running app.</span>}
    </section>
  );
}
