// The review plan, and the way into a review: decide, read closely, skim.
// Opening a branch lands here. One button starts (or continues) the review where it makes sense.
import { useEffect, useMemo, useState } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, LoadingPage, RiskPill, cleanError, isPlainKey, plural, reviewCrumbs, sizeText, useAsync, usePref } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { Select } from '../components/ui/Select.tsx';
import { matches } from '../lib/shortcuts.ts';
import { StackBar, checksText, checksTone } from '../components/github.tsx';
import { AgentTests, AskedFor, ReviewError } from './Review.tsx';
import { useCodeSearch } from '../components/search.tsx';
import { WalkthroughNotice, useWalkthroughJob } from '../components/walkthrough.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { OUTSIDE_HINT, RISK_LABEL, formatDuration, isReviewed, timeAgo, tooBig } from '../../shared/order.ts';
import { buildPlan, decisionLabels, planProgress, resumePoint, settleComment, type PlanDecision } from '../../shared/plan.ts';
import type { ReviewData, ReviewOrder, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';

const ORDERS: { id: ReviewOrder; label: string }[] = [
  { id: 'story', label: 'Story order' },
  { id: 'risk', label: 'Riskiest first' },
  { id: 'file', label: 'By file' },
];

export function PlanScreen({ go, projectId, branch, preloaded }: { go: Go; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }) {
  // A new walkthrough changes the steps: `version` reads the branch again.
  const [version, setVersion] = useState(0);
  const loaded = useAsync(() => (preloaded && version === 0 ? Promise.resolve(preloaded) : window.api.loadReview(projectId, branch)), [projectId, branch, version]);
  const value = loaded.value ?? (version === 0 ? preloaded : undefined);
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!value) return <LoadingPage onHome={() => go({ name: 'home' })} label="Reading the branch…" detail={branch} />;
  return <PlanView key={version} go={go} data={value.data} initialState={value.state} onReload={() => setVersion((v) => v + 1)} />;
}

const AUTO_BASE = '\0auto';

/** The base the review compares against. Picking another one is for this branch only, whatever the project's base. */
function BasePicker({ data, onChanged, onError }: { data: ReviewData; onChanged: () => void; onError: (message: string | null) => void }) {
  const choices = useAsync(() => window.api.listBases(data.projectId, data.branch), [data.projectId, data.branch]);
  const [busy, setBusy] = useState(false);
  const options = [
    ...(data.baseChosen ? [{ value: AUTO_BASE, label: 'Let Hunkdory pick', hint: 'project base or PR base' }] : []),
    // The current base stays listed even when it isn't a branch here, such as a PR's base.
    ...(choices.value?.some((c) => c.name === data.baseRef) ? [] : [{ value: data.baseRef, label: data.baseRef }]),
    ...(choices.value ?? []).map((c) => ({ value: c.name, label: c.name, hint: plural(c.commits, 'commit') })),
  ];
  const pick = async (value: string) => {
    setBusy(true);
    try {
      await window.api.setBase(data.projectId, data.branch, value === AUTO_BASE ? null : value);
      onError(null);
      onChanged();
    } catch (e) {
      onError(cleanError(e));
      setBusy(false);
    }
  };
  return (
    <Select
      label="Compare against"
      tooltip={data.baseChosen ? 'Compare against another branch (you picked this one)' : 'Compare against another branch'}
      value={data.baseRef}
      options={options}
      onChange={pick}
      disabled={busy}
      menuWidth={340}
      className="-mx-1 rounded px-1 font-mono text-meta text-faint hover:bg-border/45 hover:text-text"
    />
  );
}

const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const count = (n: number) => words[n] ?? String(n);

function headline(decisions: number, careful: number, skim: number) {
  if (decisions && careful) return `${count(decisions)} ${decisions === 1 ? 'decision' : 'decisions'}, then ${careful === 1 ? 'one step' : `${careful} steps`} to read closely`;
  if (decisions) return `${count(decisions)} ${decisions === 1 ? 'decision' : 'decisions'}, then a quick skim`;
  if (careful) return `${careful === 1 ? 'One step' : `${careful} steps`} to read closely${skim ? ', then a quick skim' : ''}`;
  return 'Low risk all round: a quick skim';
}

function PlanView({ go, data, initialState, onReload }: { go: Go; data: ReviewData; initialState: ReviewState; onReload: () => void }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [allCareful, setAllCareful] = useState(false);
  const [skipSeen, setSkipSeen] = useState(true);
  const [copied, setCopied] = useState(false);
  const plan = useMemo(() => buildPlan(data, state), [data, state.order]);
  const progress = planProgress(plan, state);
  // Opening a branch without a walkthrough has Hunkdory write one; the steps update when it's ready.
  const w = useWalkthroughJob(data, { auto: true, onDone: onReload });

  useEffect(
    () =>
      window.events.onReviewStateChanged((r) => {
        if (r.projectId === data.projectId && r.branch === data.branch) setState(r);
      }),
    [data.projectId, data.branch]
  );

  // A review you finished before opens a new round when you start again; one you never started gets its start time.
  const needsStart = !state.startedAt || !!state.decision;
  // What changed since your last pass, while that pass is still the latest.
  const since = useMemo(
    () => (needsStart ? sinceLastRound(data.steps, { rounds: [...(state.rounds ?? []), ...(state.decision ? [{ decision: state.decision, comments: state.comments, reviewed: state.reviewed }] : [])] }) : null),
    [data.steps, needsStart, state.rounds, state.decision]
  );
  const counts = since ? Object.values(since.byStep).reduce((n, c) => ({ ...n, [c]: n[c] + 1 }), { new: 0, changed: 0, same: 0 }) : null;

  const patch = async (p: ReviewPatch) => {
    try {
      const next = await window.api.updateReview(data.projectId, data.branch, p);
      setState(next);
      setError(null);
      return next;
    } catch (e) {
      setError(cleanError(e));
      return null;
    }
  };

  /** Starts the review (or a new round) before you go into it, so progress and timing count from here. */
  const begin = async (): Promise<ReviewState | null> => {
    if (!needsStart) return state;
    let next = await patch({ type: 'start', order: state.order });
    if (!next) return null;
    // Steps whose every change you reviewed before count as reviewed again.
    if (since && skipSeen) {
      for (const s of since.alreadyReviewed) next = (await patch({ type: 'reviewed', stepKey: s.key, hunkIds: s.hunkIds, on: true })) ?? next;
    }
    return next;
  };

  const enter = async (to: { stepKey?: string; decision?: string; group?: string }) => {
    const s = await begin();
    if (s) go({ name: 'review', projectId: data.projectId, branch: data.branch, ...to, preloaded: { data, state: s } });
  };
  const open = (step: Step | undefined) => step && enter({ stepKey: step.key });
  const search = useCodeSearch(data, (key) => open(data.steps.find((s) => s.key === key)));
  const toFinish = () => go({ name: 'finish', projectId: data.projectId, branch: data.branch });

  const resume = resumePoint(plan, state);
  const allDone = !needsStart && !resume;
  const go1 = async () => {
    if (allDone) return toFinish();
    if (needsStart) {
      const s = await begin();
      if (!s) return;
      const r = resumePoint(plan, s);
      if (!r) return toFinish();
      return go({ name: 'review', projectId: data.projectId, branch: data.branch, decision: r.decision?.id, stepKey: r.stepKey, preloaded: { data, state: s } });
    }
    if (resume) go({ name: 'review', projectId: data.projectId, branch: data.branch, decision: resume.decision?.id, stepKey: resume.stepKey, preloaded: { data, state } });
  };

  const writing = w.job?.status === 'running' && data.walkthrough === 'skeleton';
  const ctaLabel = (() => {
    if (allDone) return 'Finish the review';
    if (!resume) return 'Start review';
    const verb = needsStart ? 'Start' : 'Continue';
    if (writing && needsStart) return 'Start with one step per file';
    if (resume.decision) return `${verb}: decision ${plan.decisions.indexOf(resume.decision) + 1} of ${plan.decisions.length}`;
    return `${verb}: step ${plan.sequence.findIndex((s) => s.key === resume.stepKey) + 1} of ${plan.sequence.length}`;
  })();

  // ⌘↵ starts or continues, ⌘⇧↵ finishes: the registry's `plan.start` and `review.finish`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e)) return;
      if (matches(e, 'plan.start')) {
        e.preventDefault();
        go1();
      } else if (matches(e, 'review.finish')) {
        e.preventDefault();
        toFinish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const settle = async (d: PlanDecision, value: 'fine' | 'fix' | null) => {
    if (!(await begin())) return;
    await patch({ type: 'settle', id: d.id, value, comment: settleComment(d, d.stepKeys[0]) });
  };

  const carefulShown = allCareful ? plan.careful : plan.careful.slice(0, 8);
  const minutesFor = (n: number) => Math.max(1, Math.round((data.minutes * n) / Math.max(1, data.steps.length)));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, shrink: true }]} />
        </div>
        {data.pr && (
          <Pill tone="muted" onClick={() => window.api.openExternal(data.pr!.url)} data-tooltip="Open on GitHub">
            PR #{data.pr.number} ↗
          </Pill>
        )}
        {search.button}
        <Button variant={allDone ? 'primary' : 'quiet'} shortcut="review.finish" onClick={toFinish}>
          Finish
        </Button>
      </ViewHeader>
      {search.panel}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-7 pb-14">
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-faint">
              <span className="flex min-w-0 items-center gap-1 font-mono">
                {data.branch} → <BasePicker data={data} onChanged={onReload} onError={setError} />
              </span>
              <span>· {sizeText(data.files, data.added, data.removed)}</span>
              <span>· about {formatDuration(data.minutes)}</span>
              <span>
                ·{' '}
                {data.session
                  ? `Claude Code session, ${timeAgo(data.session.endedAt).toLowerCase()}`
                  : data.agent === 'copilot' && data.pr
                    ? `GitHub Copilot, updated ${timeAgo(data.pr.updatedAt).toLowerCase()}`
                    : data.pr
                      ? `PR by ${data.pr.author}, updated ${timeAgo(data.pr.updatedAt).toLowerCase()}`
                      : data.author
                        ? `Last commit by ${data.author}`
                        : 'No agent session found'}
              </span>
              {data.pr && data.pr.checks.length > 0 && <Pill tone={checksTone(data.pr.checks)}>CI: {checksText(data.pr.checks)}</Pill>}
            </span>
            <h1 className="text-hero font-semibold">{allDone ? 'All done. Time to wrap up.' : headline(plan.decisions.length, plan.careful.length, plan.skim.length)}</h1>
            <p className="text-body text-muted">
              {allDone
                ? 'You made every decision and looked at every step. Finish to merge, send it back, or post your review.'
                : `Hunkdory sorted the ${plural(data.steps.length, 'step')} for you. Start with what only you can decide.${plan.skim.length ? ' The low-risk rest is grouped by folder so you can skim it.' : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" shortcut={allDone ? 'review.finish' : 'plan.start'} onClick={go1}>
              {ctaLabel}
            </Button>
            <span className="flex items-center gap-1.5 text-meta text-faint">
              <Kbd shortcut="shortcuts" /> every shortcut
            </span>
          </div>

          {since && counts && (
            <Notice
              tone="info"
              actions={
                since.alreadyReviewed.length > 0 ? (
                  <Checkbox checked={skipSeen} onChange={setSkipSeen}>
                    Mark the {plural(since.alreadyReviewed.length, 'unchanged step')} as reviewed
                  </Checkbox>
                ) : undefined
              }
            >
              <strong className="font-semibold">Since your last review:</strong>{' '}
              {[counts.changed && `${plural(counts.changed, 'step')} changed`, counts.new && `${plural(counts.new, 'step')} new`, counts.same && `${counts.same} the same`].filter(Boolean).join(', ') || 'nothing changed'}
              {since.gone ? `. ${plural(since.gone, 'earlier change')} ${since.gone === 1 ? 'is' : 'are'} gone.` : '.'}{' '}
              <span className="text-muted">
                You {since.decision.kind === 'send-back' ? 'sent it back' : since.decision.kind === 'github' ? 'reviewed it on GitHub' : 'finished it'} {timeAgo(since.decision.at).toLowerCase()}.
              </span>
            </Notice>
          )}

          {data.stack && <StackBar data={data} go={go} />}
          <WalkthroughNotice data={data} w={w} />

          {tooBig({ minutes: data.minutes, steps: data.steps.length }) && (
            <Notice
              tone="caution"
              role="note"
              actions={
                <Button
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(splitRequest(data.branch, data.steps.length, formatDuration(data.minutes)));
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied' : 'Copy a request to split it'}
                </Button>
              }
            >
              <strong className="font-semibold">Too big for one sitting.</strong> About {formatDuration(data.minutes)} of reading. Smaller branches get a better review: ask the agent to split it{copied ? ' (paste the request into its session)' : ''}. Or take it over
              several sittings: Hunkdory keeps your place.{!data.baseChosen && <> More than you expected? Check the branch it compares against, next to the branch name above.</>}
            </Notice>
          )}

          <HowItWorks />
          <RequestCard data={data} onOpen={open} />

          <Phase title="Decide" count={plan.decisions.length} meta={plan.decisions.length ? `${progress.decided} of ${progress.decisions} done` : 'Nothing to decide'} hint="Calls only you can make: work you didn’t ask for, failing CI, and patterns that need attention.">
            {plan.decisions.length === 0 ? (
              <p className="text-body text-muted">No changes outside your request, no failing checks, and nothing flagged.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">
                {plan.decisions.map((d) => (
                  <DecisionCard
                    key={d.id}
                    d={d}
                    steps={data.steps}
                    value={state.settled?.[d.id]}
                    onSettle={(v) => settle(d, v)}
                    onShow={(key) => enter({ decision: d.id, stepKey: key })}
                    onCi={() => {
                      const failing = data.pr?.checks.find((c) => c.state === 'fail' && c.url);
                      window.api.openExternal(failing?.url ?? data.pr!.url);
                    }}
                  />
                ))}
              </div>
            )}
          </Phase>

          {plan.careful.length > 0 && (
            <Phase
              title="Read closely"
              count={plan.careful.length}
              meta={`${progress.carefulDone} reviewed · about ${minutesFor(plan.careful.length)} min`}
              hint="Steps that need attention, or that you didn’t ask for. Read the code."
              action={<SegmentedControl<ReviewOrder> mode="radio" label="Order" size="sm" value={state.order} onChange={(order) => patch({ type: 'order', order })} segments={ORDERS.map((o) => ({ value: o.id, label: o.label }))} />}
            >
              <ul className="m-0 flex list-none flex-col gap-px p-0">
                {carefulShown.map((s) => {
                  const done = isReviewed(s, state.reviewed);
                  const changed = since?.byStep[s.key];
                  return (
                    <li key={s.key}>
                      <button type="button" onClick={() => open(s)} className="group flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-2 text-left hover:bg-border/45">
                        <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${done ? 'bg-text' : 'border-2 border-faint'}`} />
                        <span className={`min-w-0 flex-[1_1_320px] text-body break-words ${done ? 'text-muted' : 'text-text'}`}>{s.title}</span>
                        {changed && changed !== 'same' && <Pill tone="link">{changed === 'new' ? 'New' : 'Changed'}</Pill>}
                        <RiskPill risk={s.risk} />
                        {s.outsideTask && <Pill data-tooltip={OUTSIDE_HINT}>Outside your request</Pill>}
                        <span className="w-14 text-right text-meta text-faint">{plural(s.files.length, 'file')}</span>
                        <span className={`w-20 text-right text-ui ${done ? 'text-muted' : 'text-link opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>{done ? 'Reviewed' : 'Review →'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {plan.careful.length > carefulShown.length && (
                <Button variant="quiet" className="self-start" onClick={() => setAllCareful(true)}>
                  Show {plan.careful.length - carefulShown.length} more
                </Button>
              )}
            </Phase>
          )}

          {plan.skim.length > 0 && (
            <Phase
              title="Skim"
              count={plan.skim.length}
              meta={`${progress.skimDone} reviewed · about ${minutesFor(plan.skim.length)} min`}
              hint="Low-risk steps, grouped by folder. Open a folder to see all of it on one page, then mark it reviewed in one go."
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
                {plan.skimGroups.map((g) => {
                  const done = g.steps.filter((s) => isReviewed(s, state.reviewed)).length;
                  return (
                    <div key={g.name} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                      <span className="font-mono text-ui font-semibold break-all">{g.name}</span>
                      <span className="text-meta text-faint">
                        {plural(g.steps.length, 'step')} · {plural(g.files, 'file')}
                        {done && done < g.steps.length ? ` · ${done} reviewed` : ''}
                      </span>
                      <Button size="sm" className="mt-1 self-start" onClick={() => enter({ group: g.name })}>
                        {done === g.steps.length ? 'Reviewed ✓' : 'Skim folder'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Phase>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </div>
    </div>
  );
}

/** What to ask an agent when its change is too big to review well. */
function splitRequest(branch: string, steps: number, time: string) {
  return [
    `The change on ${branch} is too big to review well: ${steps} steps, about ${time} of reading.`,
    'Split it into a stack of smaller branches, each one reviewable in under an hour and each building on the one before.',
    'Keep the code as it is: move it into the smaller branches, don’t rewrite it.',
    'Give each branch a commit message that says what it is for, and list the branches in order when you are done.',
  ].join(' ');
}

/** A first-run explainer of the review flow. Dismissed once, for good (Settings brings it back). */
function HowItWorks() {
  const [show, setShow] = usePref<boolean>('plan-how-it-works', true);
  if (!show) return null;
  const items = [
    ['Decide', 'Make the calls only you can make, like keeping or dropping work you didn’t ask for.'],
    ['Read closely', 'Go through the steps that need attention, with the agent’s reason next to each change.'],
    ['Skim', 'Glance over the low-risk rest, a folder at a time. Every changed line is in some step, so nothing is hidden.'],
    ['Finish', 'Merge, post your review, or send your comments back to the agent.'],
  ];
  return (
    <Notice tone="info" onDismiss={() => setShow(false)} aria-label="How a review works">
      <strong className="font-semibold">How a review works</strong>
      <ol className="m-0 mt-1 flex list-decimal flex-col gap-0.5 pl-5">
        {items.map(([t, d]) => (
          <li key={t}>
            <strong className="font-semibold">{t}.</strong> {d}
          </li>
        ))}
      </ol>
    </Notice>
  );
}

/** What you asked, what the change does, and what it does that you didn't ask for: the yardstick for the review. */
function RequestCard({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  const outside = data.steps.filter((s) => s.outsideTask);
  const hasRequest = !!(data.prompt || data.pr?.body.trim());
  const row = (label: string, body: React.ReactNode) => (
    <>
      <h2 className="pt-0.5 text-meta font-semibold tracking-wider text-faint uppercase">{label}</h2>
      <div className="min-w-0 text-body">{body}</div>
    </>
  );
  return (
    <section aria-label="The change" className="grid grid-cols-[minmax(96px,max-content)_1fr] gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4">
      {row(askedLabel(data), <AskedFor data={data} clamp={240} />)}
      {row('It did', data.intent ? <span className="select-text">{data.intent}</span> : <span className="text-muted">{data.walkthrough === 'skeleton' ? 'No walkthrough yet, so there is no summary: the steps are one per file.' : 'The walkthrough has no summary.'}</span>)}
      {row(
        'It also did',
        outside.length ? (
          <span className="flex flex-col items-start gap-1">
            {outside.map((s) => (
              <button key={s.key} type="button" className="text-left break-words text-link hover:underline" onClick={() => onOpen(s)}>
                Step {s.index + 1}: {s.title} ({plural(s.files.length, 'file')}) →
              </button>
            ))}
          </span>
        ) : (
          <span className="text-muted">{hasRequest ? (data.walkthrough === 'skeleton' ? 'Unknown until there is a walkthrough.' : 'Nothing outside your request.') : 'There is no request to compare with, so nothing is marked as outside it.'}</span>
        )
      )}
      {data.agentTests && row('Its tests', <AgentTests data={data} />)}
    </section>
  );
}

/** "You asked" for a prompt, "The PR says" for a PR description: the same words on every screen. */
export const askedLabel = (data: Pick<ReviewData, 'prompt' | 'pr'>) => (data.prompt || !data.pr ? 'You asked' : 'The PR says');

function Phase({ title, count, hint, meta, action, children }: { title: string; count: number; hint: string; meta: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3">
          <SectionHeader as="h2" count={count}>
            {title}
          </SectionHeader>
          <span className="flex-1 text-meta text-faint">{meta}</span>
          {action}
        </div>
        <p className="text-ui text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/** The card's label: what kind of call it is, or for a flag, how much it needs you. */
const tag = (d: PlanDecision) => (d.kind === 'outside' ? 'Outside your request' : d.kind === 'ci' ? 'CI' : RISK_LABEL[d.severity]);

function DecisionCard({ d, steps, value, onSettle, onShow, onCi }: { d: PlanDecision; steps: Step[]; value?: 'fine' | 'fix'; onSettle: (v: 'fine' | 'fix' | null) => void; onShow: (stepKey: string) => void; onCi: () => void }) {
  const [details, setDetails] = useState(false);
  const labels = decisionLabels(d);
  const stepOf = (key: string) => steps.find((s) => s.key === key);
  // You can only judge what you've seen: with steps to look at, the decision is made there, next to the code.
  const first = d.stepKeys.map(stepOf).find(Boolean);
  const single = d.stepKeys.length === 1 && first;
  return (
    <article className={`flex flex-col gap-2 rounded-xl border border-border bg-card p-4 ${value ? 'opacity-70' : ''}`}>
      <Pill tone={d.kind === 'ci' ? 'error' : d.severity === 'high' ? 'caution' : 'default'} className="self-start" data-tooltip={d.kind === 'outside' ? OUTSIDE_HINT : undefined}>
        {tag(d)}
      </Pill>
      <h3 className="m-0 text-body font-semibold break-words">{d.title}</h3>
      <p className="text-ui break-words text-muted">{d.detail}</p>
      {/* Without a walkthrough the step is named after its file, which the detail already says. */}
      {single && !d.detail.includes(single.title) && (
        <span className="text-ui break-words text-muted">
          Step {single.index + 1}: {single.title}
        </span>
      )}
      {(d.stepKeys.length > 1 || d.places.length > 1 || d.files.length > 0) && (
        <div className="flex flex-col gap-1">
          {!single &&
            d.stepKeys.slice(0, details ? undefined : 2).map((k) => {
              const s = stepOf(k);
              return s ? (
                <button key={k} type="button" className="text-left text-ui break-words text-link hover:underline" onClick={() => onShow(k)}>
                  Step {s.index + 1}: {s.title} →
                </button>
              ) : null;
            })}
          {details && d.files.length > 0 && (
            <ul className="m-0 mt-1 flex flex-col gap-0.5 pl-4 text-meta text-muted">
              {d.files.map((f) => (
                <li key={f} className="font-mono break-all">
                  {f}
                </li>
              ))}
            </ul>
          )}
          {details && d.kind === 'flag' && d.places.length > 1 && (
            <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4 text-meta text-muted">
              {d.places.map((p, i) => (
                <li key={i} className="break-words">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {(d.stepKeys.length > 2 || d.files.length > 0 || (d.kind === 'flag' && d.places.length > 1)) && (
            <button type="button" className="self-start text-meta text-link hover:underline" onClick={() => setDetails(!details)}>
              {details ? 'Show less' : d.files.length ? `Show the ${plural(d.files.length, 'file')}` : 'Show every place'}
            </button>
          )}
        </div>
      )}
      <div className="flex-1" />
      {value ? (
        <div className="flex flex-wrap items-center gap-2 text-ui">
          <span className="font-semibold text-text">✓ {value === 'fine' ? labels.fineDone : labels.fixDone}</span>
          <Button variant="quiet" size="sm" onClick={() => onSettle(null)}>
            Change
          </Button>
          {first && (
            <Button variant="quiet" size="sm" onClick={() => onShow(first.key)}>
              Look again
            </Button>
          )}
        </div>
      ) : first ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onShow(first.key)}>{single ? 'Look at the change' : `Start at step ${first.index + 1}`}</Button>
          <span className="text-meta text-faint">You decide there, next to the code.</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {d.kind === 'ci' && <Button onClick={onCi}>Open checks ↗</Button>}
          <Button onClick={() => onSettle('fine')}>{labels.fine}</Button>
          <Button onClick={() => onSettle('fix')}>{labels.fix}</Button>
        </div>
      )}
    </article>
  );
}
