// The AI review: a second opinion you ask for, on the plan and next to the lines it's about.
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type HTMLAttributes } from 'react';
import { cleanError, plural } from './ui.tsx';
import { Markdown } from './markdown.tsx';
import { Button } from './ui/Button.tsx';
import type { PillTone } from './ui/buttonStyles.ts';
import { Pill } from './ui/Pill.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { StatusLine } from './ui/StatusLine.tsx';
import { TextButton } from './ui/TextButton.tsx';
import { usageNote } from '../../shared/assistantText.ts';
import { areaLabel, findingAsk, findingsView, type PlacedFinding } from '../../shared/aiReview.ts';
import type { AiFinding, ReviewData, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';

const SEVERITY: Record<AiFinding['severity'], { label: string; tone: PillTone }> = {
  high: { label: 'High', tone: 'caution' },
  medium: { label: 'Medium', tone: 'default' },
  low: { label: 'Low', tone: 'muted' },
};

const SeverityPill = ({ f }: { f: Pick<AiFinding, 'severity'> }) => <Pill tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Pill>;

/** The findings a step shows, above its diff and at their lines. */
export const openFindingsIn = (data: ReviewData, state: ReviewState, step: Step) => findingsView(state.aiReview?.result, data, state.comments).open.filter((p) => p.step.key === step.key);

type Act = (patch: Extract<ReviewPatch, { type: 'ai-finding' }>) => void;

export function Elapsed({ from }: { from: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000));
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`}</>;
}

/** Where the AI review stands, and running or stopping it. `shown` is false for a Manual project, or one with it turned off, that never ran it. */
function useAiReview(data: ReviewData, state: ReviewState) {
  const [error, setError] = useState<string | null>(null);
  const settings = data.aiReviewSettings;
  const review = state.aiReview;
  const result = review?.result ?? null;
  const run = async () => {
    setError(null);
    try {
      await window.api.runAiReview(data.projectId, data.branch);
    } catch (e) {
      setError(cleanError(e));
    }
  };
  return {
    shown: (!!data.assistant && settings.enabled) || !!result,
    canRun: !!data.assistant && settings.enabled && settings.areas.length > 0,
    noAreas: !!data.assistant && settings.enabled && !settings.areas.length,
    running: review?.status === 'running' ? review : null,
    failed: review?.status === 'failed' ? (review.error ?? '') : null,
    result,
    view: findingsView(result, data, state.comments),
    run,
    stop: () => window.api.cancelAiReview(data.projectId, data.branch),
    error,
  };
}

/** "3 findings, on their steps", or that it found nothing. */
const foundText = (open: number) => (open ? `${plural(open, 'finding')}, on their steps.` : 'It found nothing to flag. It can miss things, so you still decide.');

/** The AI review in one line on the plan: run it, watch it run, or how many findings it left on the steps. */
export function AiReviewLine({ data, state, onSettings, ...rest }: { data: ReviewData; state: ReviewState; onSettings: () => void } & HTMLAttributes<HTMLParagraphElement>) {
  const r = useAiReview(data, state);
  if (!r.shown) return null;
  const error = r.error && <span className="text-error"> {r.error}</span>;
  if (r.running) {
    return (
      <StatusLine dot="busy" label="AI review" role="status" {...rest}>
        running. Findings show on their steps when it’s done. {r.running.activity ?? 'Working…'} · <Elapsed from={r.running.startedAt} />.{' '}
        <TextButton onClick={r.stop}>Stop</TextButton>
      </StatusLine>
    );
  }
  if (r.failed !== null) {
    return (
      <StatusLine dot="error" label="AI review" {...rest}>
        stopped before it finished{r.result ? ', so its last findings still show' : ''}. {r.failed}
        {r.canRun && (
          <>
            {' '}
            <TextButton onClick={r.run}>Try again</TextButton>
          </>
        )}
        {error}
      </StatusLine>
    );
  }
  if (!r.result) {
    return (
      <StatusLine dot="empty" label="AI review" {...rest}>
        {r.noAreas ? (
          <>
            has nothing to check yet. <TextButton onClick={onSettings}>Choose what it checks</TextButton>
          </>
        ) : (
          <>
            not run.{' '}
            <TextButton disabled={!r.canRun} data-tooltip={data.assistant ? usageNote(data.assistant) : undefined} onClick={r.run}>
              Run it
            </TextButton>
            : findings show on their steps.
          </>
        )}
        {error}
      </StatusLine>
    );
  }
  const open = r.view.open;
  return (
    <StatusLine dot={open.some((p) => p.finding.severity === 'high') ? 'caution' : open.length ? 'neutral' : 'ok'} label="AI review" {...rest}>
      {foundText(open.length)}
      {r.view.stale && ' It ran before the branch last changed.'}
      {r.canRun && (
        <>
          {' '}
          <TextButton onClick={r.run}>Run again</TextButton>
        </>
      )}
      {error}
    </StatusLine>
  );
}

/** The AI review in the Context panel: where it stands, and a button to run it. */
export function AiReviewAside({ data, state }: { data: ReviewData; state: ReviewState }) {
  const r = useAiReview(data, state);
  if (!r.shown) return null;
  const text = r.running
    ? `Running. ${r.running.activity ?? 'Working…'}`
    : r.failed !== null
      ? `Stopped before it finished. ${r.failed}`
      : !r.result
        ? r.noAreas
          ? 'Nothing to check yet: pick what it checks in the project’s settings.'
          : 'Not run. Findings show on their steps.'
        : `${foundText(r.view.open.length)}${r.view.stale ? ' It ran before the branch last changed.' : ''}`;
  return (
    <section className="flex flex-col gap-1.5 text-ui">
      <SectionHeader as="h3">AI review</SectionHeader>
      <span className={r.failed !== null ? 'text-error' : 'text-muted'}>
        {r.running && <Loader2 size={11} className="mr-1.5 inline-block animate-spin align-[-1px] text-accent-ink" aria-hidden />}
        {text}
      </span>
      {r.error && <span className="text-error">{r.error}</span>}
      <div>
        {r.running ? (
          <Button size="sm" onClick={r.stop}>
            Stop
          </Button>
        ) : (
          r.canRun && (
            <Button size="sm" data-tooltip={data.assistant ? usageNote(data.assistant) : undefined} onClick={r.run}>
              {r.failed !== null ? 'Try again' : r.result ? 'Run again' : 'Run AI review'}
            </Button>
          )
        )}
      </div>
    </section>
  );
}

/** What you can do about a finding. Asking fills in the Ask panel, for you to read and send. */
function FindingActions({ data, item, act, onAsk, size }: { data: ReviewData; item: PlacedFinding; act: Act; onAsk?: (text: string) => void; size?: 'sm' }) {
  const { finding: f, step, commented } = item;
  const canChange = !!data.ask.change.by;
  return (
    <>
      <Button size={size} onClick={() => act(commented ? { type: 'ai-finding', id: f.id, action: 'uncomment' } : { type: 'ai-finding', id: f.id, action: 'comment', stepKey: step.key })}>
        {commented ? 'Remove from comments' : 'Add as comment'}
      </Button>
      {onAsk && (
        <Button size={size} disabled={!data.ask.question.by} onClick={() => onAsk(findingAsk(f, 'question'))}>
          Ask {data.assistant?.name ?? 'the assistant'}
        </Button>
      )}
      {onAsk && (
        <Button size={size} disabled={!canChange} data-tooltip={canChange ? undefined : (data.ask.change as { reason?: string }).reason} onClick={() => onAsk(findingAsk(f, 'change'))}>
          Have it fixed
        </Button>
      )}
      <span className="flex-1" />
      <Button variant="quiet" size={size} onClick={() => act({ type: 'ai-finding', id: f.id, action: 'dismiss' })}>
        Not a problem
      </Button>
    </>
  );
}

/** A step's findings above its diff, with what you can do about each. */
export function StepFindings({ data, state, step, act, onAsk }: { data: ReviewData; state: ReviewState; step: Step; act: Act; onAsk?: (text: string) => void }) {
  const items = openFindingsIn(data, state, step);
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => {
        const f = item.finding;
        return (
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
            <FindingActions data={data} item={item} act={act} onAsk={onAsk} />
          </div>
        </section>
        );
      })}
    </>
  );
}

/** A finding right under its line in the diff, so it's still there, and can be acted on, once you've scrolled past the top. */
export function FindingAtLine({ data, item, act, onAsk }: { data: ReviewData; item: PlacedFinding; act: Act; onAsk?: (text: string) => void }) {
  const { finding: f, commented } = item;
  return (
    <div className={`flex flex-col gap-2 rounded-lg border bg-card px-3 py-2 font-sans text-ui ${f.severity === 'high' ? 'border-caution' : 'border-border'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-meta font-semibold tracking-wider text-faint uppercase">AI review</span>
        <SeverityPill f={f} />
        <strong className="min-w-0 flex-[1_1_240px] font-semibold break-words">{f.title}</strong>
        {commented && <Pill tone="muted">In your comments</Pill>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <FindingActions data={data} item={item} act={act} onAsk={onAsk} size="sm" />
      </div>
    </div>
  );
}
