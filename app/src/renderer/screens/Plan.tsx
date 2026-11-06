// The review plan, and the way into a review: decide, read closely, skim.
// Opening a branch lands here. One button starts (or continues) the review where it makes sense.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, cleanError, isPlainKey, plural, reviewCrumbs, sizeText, useAsync, usePref } from '../components/ui.tsx';
import { LoadingPage } from '../components/LoadingPage.tsx';
import { lastRead, readReview } from '../state/reviewReads.ts';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { buttonClass } from '../components/ui/buttonStyles.ts';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Dialog } from '../components/ui/Dialog.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { Select } from '../components/ui/Select.tsx';
import { TextButton } from '../components/ui/TextButton.tsx';
import { matches } from '../lib/shortcuts.ts';
import { useOnReturn, useTabActive } from '../state/tabPane.ts';
import { PrLink, PushToPrNotice, StackBar, checksText, checksTone } from '../components/github.tsx';
import { GitHubReviews } from '../components/githubThreads.tsx';
import { placeThreads } from '../../shared/threads.ts';
import { MessageSquare } from 'lucide-react';
import { AgentTests, AskedFor, LinkedIssues, NO_TEST_HINT, ReviewError, hasLinkedIssues } from './Review.tsx';
import { IssueRefsContext, Markdown } from '../components/markdown.tsx';
import { useCodeSearch } from '../components/search.tsx';
import { RunLogDialog } from '../components/runLog.tsx';
import type { LineRef } from '../components/diff.tsx';
import { AiReviewCard, FindingsPill, openFindingsIn } from '../components/aiReview.tsx';
import { ChangeOverview, RequestedList } from '../components/understand.tsx';
import { WalkthroughLine, WalkthroughNotice, useWalkthroughJob } from '../components/walkthrough.tsx';
import { RunningWork } from '../components/RunningWork.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { usageNote } from '../../shared/assistantText.ts';
import { OUTSIDE_HINT, RISK_LABEL, formatDuration, isReviewed, timeAgo, tooBig } from '../../shared/order.ts';
import { buildPlan, decisionLabels, fileNames, planProgress, resumePoint, settleComment, stepsLabel, storyResume, type PlanDecision } from '../../shared/plan.ts';
import type { ReviewData, ReviewOrder, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';

const ORDERS: { id: ReviewOrder; label: string }[] = [
  { id: 'story', label: 'Story order' },
  { id: 'risk', label: 'Riskiest first' },
  { id: 'file', label: 'By file' },
];

export function PlanScreen({ go, projectId, branch, preloaded }: { go: Go; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }) {
  // A new walkthrough changes the steps: `version` reads the branch again.
  const [version, setVersion] = useState(0);
  // Coming back to a branch shows what you saw last at once. The read replaces it when it's in.
  const [shown] = useState(() => preloaded ?? lastRead(projectId, branch));
  const loaded = useAsync(() => readReview(projectId, branch), [projectId, branch, version]);
  // Back on this tab after a while: read the branch again, in place. Someone may have pushed or replied since.
  useOnReturn(loaded.reload);
  const value = loaded.value ?? (version === 0 ? shown : undefined);
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!value) return <LoadingPage shape="plan" projectId={projectId} branch={branch} />;
  return (
    <IssueRefsContext.Provider value={value.data.references}>
      <PlanView key={version} go={go} data={value.data} initialState={value.state} onReload={() => setVersion((v) => v + 1)} />
    </IssueRefsContext.Provider>
  );
}

const AUTO_BASE = '\0auto';

/** The base the review compares against. Picking another one is for this branch only, whatever the project's base. */
function BasePicker({ data, onChanged, onError }: { data: ReviewData; onChanged: () => void; onError: (message: string | null) => void }) {
  const choices = useAsync(() => window.api.listBases(data.projectId, data.branch), [data.projectId, data.branch]);
  const [busy, setBusy] = useState(false);
  const options = [
    ...(data.baseChosen ? [{ value: AUTO_BASE, label: 'Let Hunkdory pick', hint: 'project base or PR base' }] : []),
    // A checkout with edits can leave its commits out: just what isn't committed yet.
    ...(data.dirty && !data.pr ? [{ value: data.branch, label: 'Its last commit', hint: 'uncommitted changes only' }] : []),
    // The current base stays listed even when it isn't a branch here, such as a PR's base.
    ...(data.baseRef === data.branch || choices.value?.some((c) => c.name === data.baseRef) ? [] : [{ value: data.baseRef, label: data.baseRef }]),
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
      className={`${buttonClass({ variant: 'secondary', size: 'sm', iconOnly: false, filled: false, selected: false })} font-mono`}
    />
  );
}

/** Changes what the review compares against, and nothing in git. */
function useSetBase(data: ReviewData, onChanged: () => void, onError: (message: string | null) => void) {
  const [busy, setBusy] = useState(false);
  const set = async (base: string | null) => {
    setBusy(true);
    try {
      await window.api.setBase(data.projectId, data.branch, base);
      onError(null);
      onChanged();
    } catch (e) {
      onError(cleanError(e));
      setBusy(false);
    }
  };
  return { busy, set };
}

/** The base you picked is a local branch behind origin: its commits read as this branch's. */
function StaleBaseLine({ data, onChanged, onError }: { data: ReviewData; onChanged: () => void; onError: (message: string | null) => void }) {
  const { busy, set } = useSetBase(data, onChanged, onError);
  if (!data.staleBase) return null;
  const { remote, commits } = data.staleBase;
  return (
    <p className="m-0">
      <strong className="font-semibold">{plural(commits, 'commit')} in this review {commits === 1 ? 'is' : 'are'} already on <span className="font-mono">{remote}</span>.</strong> Your local <span className="font-mono">{data.baseRef}</span> is behind, so {commits === 1 ? 'it counts' : 'they count'} as part of this branch.{' '}
      <TextButton disabled={busy} onClick={() => set(remote)}>
        Compare with <span className="font-mono">{remote}</span>
      </TextButton>
    </p>
  );
}

/** More than one sitting takes in: split it, or read it over several. */
function TooBigLine({ data }: { data: ReviewData }) {
  const [copied, setCopied] = useState(false);
  if (!tooBig({ minutes: data.minutes, steps: data.steps.length })) return null;
  return (
    <p className="m-0">
      <strong className="font-semibold">About {formatDuration(data.minutes)} of reading.</strong> Smaller branches get a better review.{' '}
      <TextButton
        onClick={async () => {
          await navigator.clipboard.writeText(splitRequest(data.branch, data.steps.length, formatDuration(data.minutes)));
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy a request to split it'}
      </TextButton>
      {copied ? ' (paste it into the agent’s session)' : ''}, or read it over several sittings: Hunkdory keeps your place.
    </p>
  );
}

/** Uncommitted edits in the branch's folder: review them on their own, or go back to the whole branch. */
function UncommittedLine({ data, onChanged, onError }: { data: ReviewData; onChanged: () => void; onError: (message: string | null) => void }) {
  const { busy, set } = useSetBase(data, onChanged, onError);
  if (!data.dirty || data.pr || (data.uncommitted && !data.baseChosen)) return null;
  const files = plural(data.dirtyFiles, 'file');
  const one = data.dirtyFiles === 1;
  return data.uncommitted ? (
    <p className="m-0">
      <strong className="font-semibold">Only the uncommitted changes.</strong> You’re reviewing the {files} on <span className="font-mono">{data.branch}</span> that {one ? 'isn’t' : 'aren’t'} committed yet, against its last commit.{' '}
      <TextButton disabled={busy} onClick={() => set(null)}>
        Include its commits
      </TextButton>
    </p>
  ) : (
    <p className="m-0">
      <strong className="font-semibold">{files} {one ? 'isn’t' : 'aren’t'} committed yet.</strong> {one ? 'It’s' : 'They’re'} part of this review, on top of the commits.{' '}
      <TextButton disabled={busy} onClick={() => set(data.branch)}>
        Review only {one ? 'that' : 'those'}
      </TextButton>
    </p>
  );
}

/** How the steps are ordered: the current one as plain text, the others to pick. */
function OrderPicker({ value, onChange }: { value: ReviewOrder; onChange: (order: ReviewOrder) => void }) {
  return (
    <span role="group" aria-label="Order" className="text-ui text-muted">
      {ORDERS.map((o, i) => (
        <Fragment key={o.id}>
          {i > 0 && ' · '}
          {o.id === value ? <span aria-current="true">{o.label}</span> : <TextButton onClick={() => onChange(o.id)}>{o.label}</TextButton>}
        </Fragment>
      ))}
    </span>
  );
}

function PlanView({ go, data, initialState, onReload }: { go: Go; data: ReviewData; initialState: ReviewState; onReload: () => void }) {
  const [state, setState] = useState(initialState);
  // A new read of the branch knows best, also over what was shown until it came in.
  useEffect(() => setState(initialState), [initialState]);
  const [error, setError] = useState<string | null>(null);
  const [allCareful, setAllCareful] = useState(false);
  const [skipSeen, setSkipSeen] = useState(true);
  const [howItWorks, setHowItWorks] = useState(false);
  const plan = useMemo(() => buildPlan(data, state), [data, state.order, state.aiReview]);
  const progress = planProgress(plan, state);
  // What people said on GitHub. Replying or resolving here changes it without reading the branch again.
  const [feedback, setFeedback] = useState(data.github);
  useEffect(() => setFeedback(data.github), [data.github]);
  const placed = useMemo(() => placeThreads(feedback?.threads ?? [], data.hunks), [feedback, data.hunks]);
  // Each thread on this diff with its step, open ones first, in the order of the steps.
  const inDiff = useMemo(
    () =>
      [...placed.byHunk]
        .flatMap(([id, threads]) => {
          const step = data.steps.find((s) => s.hunkIds.includes(id));
          return step ? threads.map((thread) => ({ thread, step })) : [];
        })
        .sort((a, b) => Number(a.thread.resolved) - Number(b.thread.resolved) || a.step.index - b.step.index || (a.thread.line ?? 0) - (b.thread.line ?? 0)),
    [placed, data.steps]
  );
  const openThreadsIn = (steps: Step[]) => steps.flatMap((s) => s.hunkIds.flatMap((id) => placed.byHunk.get(id) ?? [])).filter((t) => !t.resolved).length;
  // Opening a branch without a walkthrough has Hunkdory write one; the steps update when it's ready.
  const w = useWalkthroughJob(data, { auto: true, onDone: onReload });
  // The cards the running pills in the top bar scroll to. Only the page moves: scrollIntoView also shifts the panes around it, top bar included.
  const scroller = useRef<HTMLDivElement>(null);
  const walkthroughCard = useRef<HTMLDivElement>(null);
  const aiReviewCard = useRef<HTMLDivElement>(null);
  const scrollToCard = (card: HTMLElement | null) => {
    const page = scroller.current;
    if (page && card) page.scrollTo({ top: page.scrollTop + card.getBoundingClientRect().top - page.getBoundingClientRect().top - 16, behavior: 'smooth' });
  };

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

  const enter = async (to: { stepKey?: string; decision?: string; group?: string; focus?: LineRef }) => {
    const s = await begin();
    if (s) go({ name: 'review', projectId: data.projectId, branch: data.branch, ...to, preloaded: { data, state: s } });
  };
  const open = (step: Step | undefined) => step && enter({ stepKey: step.key });
  const search = useCodeSearch(data, (key, focus) => enter({ stepKey: key, focus }));
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

  // With a walkthrough there's a story to read, top to bottom. Without one, the plan's order is all there is.
  const nothing = data.steps.length === 0;
  const story = data.walkthrough !== 'skeleton' && !nothing ? storyResume(data, state) : null;
  const readStory = async () => {
    const s = await begin();
    const at = s && storyResume(data, s);
    if (at) go({ name: 'review', projectId: data.projectId, branch: data.branch, story: true, stepKey: at.step.key, preloaded: { data, state: s } });
  };
  const primary = story ? readStory : go1;
  const primaryLabel = story ? (story.started && !needsStart ? `Continue the story: step ${story.at} of ${story.of}` : 'Read the story') : ctaLabel;

  // ⌘↵ starts or continues, ⌘⇧↵ finishes: the registry's `plan.start` and `review.finish`.
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e)) return;
      if (matches(e, 'plan.start')) {
        e.preventDefault();
        void (nothing ? toFinish() : primary());
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
  const oneFileEach = plan.careful.every((s) => s.files.length === 1);
  const minutesFor = (n: number) => Math.max(1, Math.round((data.minutes * n) / Math.max(1, data.steps.length)));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, shrink: true }]} />
        </div>
        <RunningWork data={data} state={state} onOpen={(kind) => scrollToCard((kind === 'walkthrough' ? walkthroughCard : aiReviewCard).current)} />
        <PrLink data={data} />
        {search.button}
        <Button variant={allDone ? 'primary' : 'quiet'} shortcut="review.finish" onClick={toFinish}>
          Finish
        </Button>
      </ViewHeader>
      {search.panel}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pt-7 pb-14">
          <div className="flex flex-col gap-2.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-faint">
              <span className="flex min-w-0 items-baseline gap-1 font-mono">
                {/* The branch is what you're reviewing: it stands out from the grey line around it. */}
                {data.uncommitted && !data.baseChosen ? (
                  <>
                    <span className="font-sans">Uncommitted on</span> <span className="truncate font-semibold text-text">{data.branch}</span>
                  </>
                ) : (
                  <>
                    <span className="truncate font-semibold text-text">{data.branch}</span> <span className="font-sans">compared with</span> <BasePicker data={data} onChanged={onReload} onError={setError} />
                  </>
                )}
              </span>
              <span>· {sizeText(data.files, data.added, data.removed)}</span>
              <span>· about {formatDuration(data.minutes)}</span>
              <span>
                ·{' '}
                {data.session
                  ? `${data.sessionProbable ? 'Probably a ' : 'A '}${data.session.agent === 'copilot' ? 'GitHub Copilot' : 'Claude Code'} session, ${timeAgo(data.session.endedAt).toLowerCase()}`
                  : data.agent === 'copilot' && data.pr
                    ? `GitHub Copilot, updated ${timeAgo(data.pr.updatedAt).toLowerCase()}`
                    : data.pr
                      ? `PR by ${data.pr.author}, updated ${timeAgo(data.pr.updatedAt).toLowerCase()}`
                      : data.author
                        ? `Last commit by ${data.author}`
                        : data.uncommitted
                          ? 'Not committed yet'
                          : 'No agent session found'}
              </span>
              {data.session && data.sessionProbable && (
                <TextButton
                  onClick={async () => {
                    await window.api.unlinkSession(data.projectId, data.session!.id, true);
                    onReload();
                  }}
                >
                  Not this session? Unlink
                </TextButton>
              )}
              {data.pr && data.pr.checks.length > 0 && <Pill tone={checksTone(data.pr.checks)}>CI: {checksText(data.pr.checks)}</Pill>}
            </span>
            {/* The story first: what this change is, in words, before how much of it there is. */}
            <h1 className="text-hero font-semibold break-words">{data.title}</h1>
            {data.intent ? <p className="text-body select-text">{data.intent}</p> : !nothing && data.walkthrough !== 'skeleton' && <p className="text-body text-muted">The walkthrough has no summary.</p>}
            {!nothing && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button variant="primary" size="lg" shortcut={allDone ? 'review.finish' : 'plan.start'} onClick={primary}>
                  {primaryLabel}
                </Button>
                {story && resume && (plan.decisions.length > 0 || data.steps.length > 1) && (
                  <Button size="lg" onClick={go1}>
                    Start with what needs me
                  </Button>
                )}
                {data.walkthrough === 'skeleton' && data.assistant && !writing && !w.asking && (
                  <>
                    <Button size="lg" onClick={w.write}>
                      {w.failed ? 'Try again' : 'Write a walkthrough'}
                    </Button>
                    <span className="text-meta text-faint">{usageNote(data.assistant)}</span>
                  </>
                )}
              </div>
            )}
          </div>
          {nothing && (
            <Notice tone="neutral" actions={<Button size="sm" onClick={toFinish}>Close this review</Button>}>
              <strong className="font-semibold text-text">There's nothing to review here.</strong> This branch has no changes compared with <span className="font-mono">{data.baseRef}</span>: it may be merged already, or its commits cancel each other out.
            </Notice>
          )}

          <SendBackStatus data={data} state={state} onFinish={toFinish} />

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

          {/* What to know before you start, in one place. Each line takes itself out, and with none left so does the block. */}
          <section ref={data.walkthrough === 'skeleton' ? walkthroughCard : undefined} aria-label="Before you start" className="flex flex-col gap-1.5 border-l-[3px] border-caution pl-3 text-body empty:hidden">
            <StaleBaseLine data={data} onChanged={onReload} onError={setError} />
            {!nothing && data.walkthrough === 'skeleton' && <WalkthroughLine data={data} w={w} />}
            {!nothing && <TooBigLine data={data} />}
            <UncommittedLine data={data} onChanged={onReload} onError={setError} />
          </section>
          <PushToPrNotice data={data} onPushed={onReload} />
          {data.stack && <StackBar data={data} go={go} />}

          {!nothing && (
          <>
          <RequestCard data={data} onOpen={open} />
          <ChangeOverview data={data} onOpen={open} />
          {data.walkthrough !== 'skeleton' && (
            <div ref={walkthroughCard} className="empty:hidden">
              <WalkthroughNotice data={data} w={w} />
            </div>
          )}

          <HowItWorksOnce data={data} />
          <div ref={aiReviewCard} className="empty:hidden">
            <AiReviewCard
              data={data}
              state={state}
              act={async (p) => {
                // A comment belongs to a review: it starts here, like settling a decision does.
                if (p.action !== 'comment' || (await begin())) await patch(p);
              }}
              onOpen={({ finding: f, step }) => enter({ stepKey: step.key, focus: { path: f.path, line: f.line, side: f.side } })}
              onSettings={() => go({ name: 'connect', projectId: data.projectId })}
            />
          </div>
          {feedback && (
            <GitHubReviews
              data={data}
              feedback={feedback}
              inDiff={inDiff}
              elsewhere={placed.elsewhere}
              onFeedback={(f) => f && setFeedback(f)}
              onOpen={(step, t) => enter({ stepKey: step.key, focus: { path: t.path, line: t.line ?? undefined, side: t.side } })}
            />
          )}

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
              action={<OrderPicker value={state.order} onChange={(order) => patch({ type: 'order', order })} />}
            >
              <ul className="m-0 flex list-none flex-col gap-px p-0">
                {carefulShown.map((s) => {
                  const done = isReviewed(s, state.reviewed);
                  const changed = since?.byStep[s.key];
                  const threads = openThreadsIn([s]);
                  return (
                    <li key={s.key}>
                      <button type="button" onClick={() => open(s)} className="group flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-2 text-left hover:bg-border/45">
                        <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${done ? 'bg-text' : 'border-2 border-faint'}`} />
                        {/* Without a walkthrough a step's title is its file's path. */}
                        <span className={`min-w-0 flex-[1_1_320px] ${s.source === 'skeleton' ? 'font-mono text-ui [overflow-wrap:anywhere]' : 'text-body break-words'} ${done ? 'text-muted' : 'text-text'}`}>{s.title}</span>
                        {changed && changed !== 'same' && <Pill tone="link">{changed === 'new' ? 'New' : 'Changed'}</Pill>}
                        {threads > 0 && (
                          <Pill tone="link" icon={<MessageSquare size={12} aria-hidden />} data-tooltip={`${plural(threads, 'open comment')} on GitHub`}>
                            {threads}
                          </Pill>
                        )}
                        <span className="text-meta text-muted">{RISK_LABEL[s.risk]}</span>
                        {s.outsideTask && <Pill data-tooltip={OUTSIDE_HINT}>Outside your request</Pill>}
                        {s.noTestChange && <Pill tone="muted" data-tooltip={NO_TEST_HINT}>No test changed</Pill>}
                        <FindingsPill data={data} state={state} step={s} />
                        {!oneFileEach && <span className="w-14 text-right text-meta text-faint">{plural(s.files.length, 'file')}</span>}
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
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {plan.skimGroups.map((g) => {
                  const done = g.steps.filter((s) => isReviewed(s, state.reviewed)).length;
                  const threads = openThreadsIn(g.steps);
                  const findings = g.steps.reduce((n, s) => n + openFindingsIn(data, state, s).length, 0);
                  return (
                    <li key={g.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1">
                      <span className="min-w-0 flex-[1_1_240px] font-mono text-ui [overflow-wrap:anywhere]">{g.name}</span>
                      <span className="text-meta text-faint">
                        {plural(g.steps.length, 'step')} · {plural(g.files, 'file')}
                        {done && done < g.steps.length ? ` · ${done} reviewed` : ''}
                        {threads ? ` · ${plural(threads, 'comment')} on GitHub` : ''}
                        {findings ? ` · ${plural(findings, 'AI finding')}` : ''}
                      </span>
                      <Button size="sm" onClick={() => enter({ group: g.name })}>
                        {done === g.steps.length ? 'Reviewed ✓' : 'Skim folder'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Phase>
          )}

          <p className="m-0 flex flex-wrap items-center gap-x-1 text-meta text-faint">
            New here? <TextButton onClick={() => setHowItWorks(true)}>How a review works</TextButton> · <Kbd shortcut="shortcuts" /> every shortcut
          </p>
          {howItWorks && (
            <Dialog title="How a review works" onClose={() => setHowItWorks(false)}>
              <HowItWorksList data={data} />
            </Dialog>
          )}
          </>
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

function HowItWorksList({ data }: { data: ReviewData }) {
  const name = data.assistant?.name;
  const items = [
    ['Read the story', `Each step explains one part in plain words, in order.${name ? ` Ask ${name} about anything that isn’t clear, or have it make a change, right there on the step.` : ''}`],
    ['Or start with what needs you', 'Calls only you can make come first, like work you didn’t ask for, then the steps that need attention, then a skim of the low-risk rest.'],
    ['Nothing is hidden', 'Every changed line is in some step.'],
    ['Finish', name ? 'Merge, post your review on GitHub, or send your comments back to the agent.' : 'Merge, or post your review on GitHub.'],
  ];
  return (
    <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
      {items.map(([t, d]) => (
        <li key={t}>
          <strong className="font-semibold">{t}.</strong> {d}
        </li>
      ))}
    </ul>
  );
}

/** The explainer on your first plan, that one time (Settings brings it back). After that it's the link at the bottom of the page. */
function HowItWorksOnce({ data }: { data: ReviewData }) {
  const [unseen, setUnseen] = usePref<boolean>('plan-how-it-works', true);
  const [show, setShow] = useState(unseen);
  useEffect(() => {
    if (unseen) setUnseen(false);
  }, []);
  if (!show) return null;
  return (
    <Notice tone="info" onDismiss={() => setShow(false)} aria-label="How a review works">
      <strong className="font-semibold">How a review works</strong>
      <div className="mt-1">
        <HowItWorksList data={data} />
      </div>
    </Notice>
  );
}

/** An agent you sent this branch back to: still working, or stopped without finishing, with its log either way. */
function SendBackStatus({ data, state, onFinish }: { data: ReviewData; state: ReviewState; onFinish(): void }) {
  const [log, setLog] = useState(false);
  const d = state.decision;
  if (d?.kind !== 'send-back' || d.github || d.result === 'ok') return null;
  const showLog = d.logFile && (
    <Button size="sm" onClick={() => setLog(true)}>
      Show the run log
    </Button>
  );
  const dialog = log && <RunLogDialog projectId={data.projectId} branch={data.branch} onClose={() => setLog(false)} />;
  if (d.result === 'running') {
    return (
      <Notice
        tone="info"
        role="status"
        actions={
          <>
            {showLog}
            <Button size="sm" onClick={() => window.api.cancelSendBack(data.projectId, data.branch)}>
              Stop
            </Button>
          </>
        }
      >
        {dialog}
        <strong className="font-semibold">The agent is working on your feedback.</strong> You can keep reading. This page shows what it already changed once you open it again.
      </Notice>
    );
  }
  return (
    <Notice
      tone="error"
      actions={
        <>
          {showLog}
          <Button size="sm" onClick={onFinish}>
            Send it back again
          </Button>
        </>
      }
    >
      {dialog}
      <strong className="font-semibold">The agent didn't finish.</strong> {d.message}
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
    <section aria-label="The change" className="grid grid-cols-[minmax(96px,max-content)_minmax(0,1fr)] gap-x-5 gap-y-2.5 border-t border-border pt-5">
      {data.background && row('To know first', <div className="select-text"><Markdown text={data.background} /></div>)}
      {row(askedLabel(data), <AskedFor data={data} clamp={240} plain />)}
      {hasLinkedIssues(data) && row('Linked issues', <LinkedIssues data={data} clamp={240} plain />)}
      {data.requested.length > 0 && row('Asked vs found', <RequestedList data={data} onOpen={onOpen} />)}
      {row(
        'It also did',
        outside.length ? (
          <span className="flex flex-col items-start gap-1">
            {outside.map((s) => (
              <TextButton key={s.key} className="max-w-full break-words" onClick={() => onOpen(s)}>
                Step {s.index + 1}: {s.title} ({plural(s.files.length, 'file')}) →
              </TextButton>
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
export const askedLabel = (data: Pick<ReviewData, 'prompt' | 'pr'>) => (data.prompt ? 'You asked' : data.pr ? 'The PR says' : 'The request');

function Phase({ title, count, hint, meta, action, children }: { title: string; count: number; hint?: string; meta: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-border pt-5">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SectionHeader as="h2" count={count}>
            {title}
          </SectionHeader>
          <span className="min-w-0 flex-[1_1_200px] text-meta text-faint">{meta}</span>
          {action}
        </div>
        {hint && <p className="text-ui text-muted">{hint}</p>}
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
  const single = d.stepKeys.length === 1 && d.stepIndexes.length <= 1 && first;
  const moreToShow = d.stepKeys.length > 1 || d.files.length > 2 || (d.kind === 'flag' && d.places.length > 1);
  return (
    <article className={`flex flex-col gap-2 rounded-xl border border-border bg-card p-4 ${value ? 'opacity-70' : ''}`}>
      <Pill tone={d.kind === 'ci' ? 'error' : 'default'} className="self-start" data-tooltip={d.kind === 'outside' ? OUTSIDE_HINT : undefined}>
        {tag(d)}
      </Pill>
      <h3 className="m-0 text-title font-semibold break-words">{d.title}</h3>
      {d.note && <p className="text-ui break-words text-muted">{d.note}</p>}
      {d.files.length > 0 && <span className="font-mono text-ui text-muted [overflow-wrap:anywhere]">{fileNames(d.files)}</span>}
      {/* Without a walkthrough a step is named after its file, which the line above already says. */}
      {single && first.source !== 'skeleton' ? (
        <span className="text-ui break-words text-muted">
          Step {first.index + 1}: {first.title}
        </span>
      ) : (
        (d.stepIndexes.length > 0 || single) && <span className="text-ui text-muted">{stepsLabel(d.stepIndexes.length ? d.stepIndexes : [first!.index])}</span>
      )}
      {moreToShow && (
        <div className="flex flex-col gap-1">
          {details &&
            d.stepKeys.map((k) => {
              const s = stepOf(k);
              return s ? (
                <TextButton key={k} className="text-ui break-words" onClick={() => onShow(k)}>
                  Step {s.index + 1}: {s.title} →
                </TextButton>
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
          <TextButton className="self-start text-meta" onClick={() => setDetails(!details)}>
            {details ? 'Show less' : d.files.length > 2 ? `Show the ${plural(d.files.length, 'file')}` : 'Show every place'}
          </TextButton>
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
        <div>
          <Button onClick={() => onShow(first.key)}>Look at the change</Button>
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
