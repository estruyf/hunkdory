// The AI review: a second opinion you ask for, on the plan and next to the lines it's about.
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cleanError, plural } from './ui.tsx';
import { Markdown } from './markdown.tsx';
import { Button } from './ui/Button.tsx';
import type { PillTone } from './ui/buttonStyles.ts';
import { Notice } from './ui/Notice.tsx';
import { Pill } from './ui/Pill.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { usageNote } from '../../shared/assistantText.ts';
import { areaLabel, findingAsk, findingsView, notChecked, type PlacedFinding } from '../../shared/aiReview.ts';
import { timeAgo } from '../../shared/order.ts';
import type { AiFinding, ReviewData, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';

const SEVERITY: Record<AiFinding['severity'], { label: string; tone: PillTone }> = {
  high: { label: 'High', tone: 'caution' },
  medium: { label: 'Medium', tone: 'default' },
  low: { label: 'Low', tone: 'muted' },
};

const OPINION = 'This is an AI’s opinion of the code. It can be wrong and it can miss things, so a short list doesn’t mean the change is safe.';

/** The chip on a step in a list of steps: it stands out when a finding on it is serious. */
export function FindingsPill({ data, state, step }: { data: ReviewData; state: ReviewState; step: Step }) {
  const found = openFindingsIn(data, state, step);
  if (!found.length) return null;
  return <Pill tone={found.some((p) => p.finding.severity === 'high') ? 'caution' : 'default'}>{plural(found.length, 'AI finding')}</Pill>;
}

const SeverityPill = ({ f }: { f: Pick<AiFinding, 'severity'> }) => <Pill tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Pill>;

/** How many findings the plan and the steps show for a step. */
export const openFindingsIn = (data: ReviewData, state: ReviewState, step: Step) => findingsView(state.aiReview?.result, data, state.comments).open.filter((p) => p.step.key === step.key);

type Act = (patch: Extract<ReviewPatch, { type: 'ai-finding' }>) => void;

function Scope({ areas }: { areas: AiFinding['area'][] }) {
  const missing = notChecked(areas);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-ui">
      <span>
        <span className="text-muted">Checked:</span> {areas.map(areaLabel).join(', ')}
      </span>
      {missing.length > 0 && (
        <span>
          <span className="text-muted">Not checked:</span> {missing.map(areaLabel).join(', ')}
        </span>
      )}
    </div>
  );
}

function FindingRow({ item, open, onToggle, onShow, act }: { item: PlacedFinding; open: boolean; onToggle: () => void; onShow: () => void; act: Act }) {
  const { finding: f, step, commented } = item;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-[1_1_320px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-border/45">
          <Chevron size={13} className="shrink-0 text-faint" aria-hidden />
          <span className="w-16 shrink-0">
            <SeverityPill f={f} />
          </span>
          <span className="w-21 shrink-0 text-meta text-faint">{areaLabel(f.area)}</span>
          <span className="min-w-0 flex-1 text-body break-words">{f.title}</span>
        </button>
        {commented && <Pill tone="muted">In your comments</Pill>}
        <span className="font-mono text-meta break-all text-faint">
          {f.path.split('/').pop()}:{f.line}
        </span>
        <button type="button" className="pr-2.5 text-ui text-link hover:underline" onClick={onShow}>
          Step {step.index + 1} →
        </button>
      </div>
      {open && (
        <div className="mb-2.5 ml-8 flex flex-col gap-2.5 px-2.5 py-1">
          <div className="flex flex-col gap-0.5">
            <span className="text-meta font-semibold tracking-wider text-faint uppercase">How it fails</span>
            <div className="text-body break-words select-text">
              <Markdown text={f.fails} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => act(commented ? { type: 'ai-finding', id: f.id, action: 'uncomment' } : { type: 'ai-finding', id: f.id, action: 'comment', stepKey: step.key })}>{commented ? 'Remove from comments' : 'Add as comment'}</Button>
            <Button onClick={onShow}>Look at the code</Button>
            <span className="flex-1" />
            <Button variant="quiet" onClick={() => act({ type: 'ai-finding', id: f.id, action: 'dismiss' })}>
              Not a problem
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function Elapsed({ from }: { from: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000));
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`}</>;
}

/** The review on the plan: the button, the run, or what it found. Nothing for a Manual project, or one with it turned off. */
export function AiReviewCard({ data, state, act, onOpen, onSettings }: { data: ReviewData; state: ReviewState; act: Act; onOpen: (p: PlacedFinding) => void; onSettings: () => void }) {
  const [opened, setOpened] = useState<string | null | undefined>(undefined);
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = data.aiReviewSettings;
  const review = state.aiReview;
  const result = review?.result ?? null;
  const assistant = data.assistant;
  if ((!assistant || !settings.enabled) && !result) return null;

  const run = async () => {
    setError(null);
    try {
      await window.api.runAiReview(data.projectId, data.branch);
    } catch (e) {
      setError(cleanError(e));
    }
  };
  const canRun = !!assistant && settings.enabled && settings.areas.length > 0;
  const running = review?.status === 'running';
  const view = findingsView(result, data, state.comments);
  // The most serious one starts open, until you open or close one yourself.
  const openId = opened === undefined ? view.open[0]?.finding.id : opened;
  const nothing = view.open.length === 0 && view.outdated.length === 0 && view.dismissed.length === 0;

  const runRow = running && (
    <div role="status" className="flex flex-wrap items-center gap-3">
      <Loader2 size={15} className="shrink-0 animate-spin text-accent-ink" aria-hidden />
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-0.5">
        <strong className="text-body font-semibold">The AI review is running.</strong>
        <span className="text-ui text-muted">
          You can start reading now. Findings show up here and on their steps when it’s done. {review.activity ?? 'Working…'} · <Elapsed from={review.startedAt} />
        </span>
      </div>
      <Button onClick={() => window.api.cancelAiReview(data.projectId, data.branch)}>Stop</Button>
    </div>
  );
  const failed = review?.status === 'failed' && (
    <Notice tone="error" actions={canRun ? <Button size="sm" onClick={run}>Try again</Button> : undefined}>
      <strong className="font-semibold">The AI review stopped before it finished{result ? ', so this is still the last result' : ', so nothing was reviewed'}.</strong> {review.error}
    </Notice>
  );

  return (
    <section aria-label="AI review" className="flex flex-col gap-2.5 border-t border-border pt-5">
      {!result && !running && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-0.5">
            <SectionHeader as="h2">AI review</SectionHeader>
            <span className="text-body">
              {settings.areas.length ? `A second opinion before you read: ${assistant!.name} looks for ${settings.areas.map((a) => areaLabel(a).toLowerCase()).join(', ')} issues in this change.` : 'Choose what it should check in the project’s settings first.'}
            </span>
            <span className="text-meta text-faint">
              {usageNote(assistant!)} {settings.depth === 'quick' ? 'Quick' : 'Thorough'} ·{' '}
              <button type="button" className="text-link hover:underline" onClick={onSettings}>
                Change what it checks
              </button>
            </span>
          </div>
          <Button disabled={!canRun} onClick={run}>
            Run AI review
          </Button>
        </div>
      )}
      {runRow}
      {failed}
      {error && <Notice tone="error">{error}</Notice>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SectionHeader as="h2" count={view.open.length}>
              AI review
            </SectionHeader>
            <span className="min-w-0 flex-[1_1_280px] text-meta text-faint">
              {[result.assistant, result.depth === 'quick' ? 'Quick' : 'Thorough', timeAgo(result.finishedAt)].filter(Boolean).join(' · ')}
            </span>
            {!running && canRun && (
              <Button variant={view.stale ? 'secondary' : 'quiet'} size="sm" onClick={run}>
                Run again
              </Button>
            )}
            <button type="button" className="text-ui text-link hover:underline" onClick={onSettings}>
              Settings
            </button>
          </div>
          <Scope areas={result.areas} />
          {view.stale && <p className="text-ui text-muted">The branch changed after this ran, so it hasn’t seen the new code.</p>}

          {nothing && (
            <p className="text-body">
              <strong className="font-semibold">It found nothing to flag in this change.</strong> That doesn’t mean the change is safe: it can miss things, and it read the code without running the app. You still decide.
            </p>
          )}

          {view.open.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {view.open.map((item) => (
                <FindingRow key={item.finding.id} item={item} open={openId === item.finding.id} onToggle={() => setOpened(openId === item.finding.id ? null : item.finding.id)} onShow={() => onOpen(item)} act={act} />
              ))}
            </ul>
          )}

          {view.outdated.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Outdated findings">
              {view.outdated.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1 text-muted">
                  <span className="w-16 shrink-0">
                    <Pill tone="muted">Outdated</Pill>
                  </span>
                  <span className="w-21 shrink-0 text-meta text-faint">{areaLabel(f.area)}</span>
                  <span className="min-w-0 flex-[1_1_240px] break-words line-through">{f.title}</span>
                  <span className="text-ui">That code changed. Check it again.</span>
                </li>
              ))}
            </ul>
          )}

          {showDismissed && view.dismissed.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Dismissed findings">
              {view.dismissed.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1 text-muted">
                  <span className="w-16 shrink-0">
                    <SeverityPill f={f} />
                  </span>
                  <span className="w-21 shrink-0 text-meta text-faint">{areaLabel(f.area)}</span>
                  <span className="min-w-0 flex-[1_1_240px] break-words">{f.title}</span>
                  <Button variant="quiet" size="sm" onClick={() => act({ type: 'ai-finding', id: f.id, action: 'restore' })}>
                    Bring back
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-faint">
            <span className="min-w-0 flex-[1_1_360px]">
              {nothing ? '' : OPINION}
              {result.cut > 0 && ` It found ${plural(result.cut, 'more finding')} than the project’s limit, the least serious ones.`}
              {result.dropped > 0 && ` ${plural(result.dropped, 'finding')} pointed at lines this change didn’t touch, so Hunkdory left ${result.dropped === 1 ? 'it' : 'them'} out.`}
            </span>
            {view.dismissed.length > 0 && (
              <button type="button" className="text-link hover:underline" onClick={() => setShowDismissed(!showDismissed)}>
                {showDismissed ? 'Hide' : 'Show'} {view.dismissed.length} dismissed
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** A step's findings above its diff, with what you can do about each. Asking fills in the Ask panel, for you to read and send. */
export function StepFindings({ data, state, step, act, onAsk }: { data: ReviewData; state: ReviewState; step: Step; act: Act; onAsk?: (text: string) => void }) {
  const items = openFindingsIn(data, state, step);
  if (!items.length) return null;
  const canAsk = !!data.ask.question.by;
  const canChange = !!data.ask.change.by;
  return (
    <>
      {items.map(({ finding: f, commented }) => (
        <section key={f.id} aria-label="AI review finding" className={`flex flex-col gap-2 rounded-xl border bg-card px-3.5 py-3 ${f.severity === 'high' ? 'border-caution' : 'border-border'}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-meta font-semibold tracking-wider text-faint uppercase">AI review</span>
            <SeverityPill f={f} />
            <span className="text-meta text-faint">
              {areaLabel(f.area)} · <span className="font-mono">{f.path.split('/').pop()}</span> line {f.line}
            </span>
          </div>
          <strong className="text-body font-semibold break-words select-text">{f.title}</strong>
          <div className="text-body break-words select-text">
            <Markdown text={f.fails} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => act(commented ? { type: 'ai-finding', id: f.id, action: 'uncomment' } : { type: 'ai-finding', id: f.id, action: 'comment', stepKey: step.key })}>{commented ? 'Remove from comments' : 'Add as comment'}</Button>
            {onAsk && (
              <Button disabled={!canAsk} onClick={() => onAsk(findingAsk(f, 'question'))}>
                Ask {data.assistant?.name ?? 'the assistant'}
              </Button>
            )}
            {onAsk && (
              <Button disabled={!canChange} data-tooltip={canChange ? undefined : (data.ask.change as { reason?: string }).reason} onClick={() => onAsk(findingAsk(f, 'change'))}>
                Have it fixed
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="quiet" onClick={() => act({ type: 'ai-finding', id: f.id, action: 'dismiss' })}>
              Not a problem
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}

/** A finding right under its line in the diff, so it's still there once you've scrolled past the top. */
export function FindingAtLine({ finding: f, commented }: { finding: AiFinding; commented: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card px-3 py-2 font-sans text-ui ${f.severity === 'high' ? 'border-caution' : 'border-border'}`}>
      <span className="text-meta font-semibold tracking-wider text-faint uppercase">AI review</span>
      <SeverityPill f={f} />
      <strong className="min-w-0 flex-[1_1_240px] font-semibold break-words">{f.title}</strong>
      {commented && <Pill tone="muted">In your comments</Pill>}
    </div>
  );
}
