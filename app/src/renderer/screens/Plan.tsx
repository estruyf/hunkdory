// The review's cover, and the way into a review: what the change is, one button to start, and what to know first.
// Opening a branch lands here. The pages about the change as a whole, and the steps, are in the review itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, cleanError, isPlainKey, plural, reviewCrumbs, sizeText, useAsync } from '../components/ui.tsx';
import { LoadingPage } from '../components/LoadingPage.tsx';
import { lastRead, readReview } from '../state/reviewReads.ts';
import { openedByLink } from '../state/links.ts';
import { OpenInSeshboard } from '../components/OpenInSeshboard.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { buttonClass } from '../components/ui/buttonStyles.ts';
import { Dialog } from '../components/ui/Dialog.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Select } from '../components/ui/Select.tsx';
import { StatusLine } from '../components/ui/StatusLine.tsx';
import { TextButton } from '../components/ui/TextButton.tsx';
import { matches } from '../lib/shortcuts.ts';
import { useOnReturn, useTabActive } from '../state/tabPane.ts';
import { PrLink, PushToPrNotice, StackBar, checkCounts, checksText } from '../components/github.tsx';
import { ReviewError } from './Review.tsx';
import { IssueRefsContext } from '../components/markdown.tsx';
import { useCodeSearch } from '../components/search.tsx';
import { RunLogDialog } from '../components/runLog.tsx';
import { AiReviewLine } from '../components/aiReview.tsx';
import { WalkthroughStatus, useWalkthroughJob } from '../components/walkthrough.tsx';
import { RunningWork } from '../components/RunningWork.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { usageNote } from '../../shared/assistantText.ts';
import { formatDuration, timeAgo, tooBig } from '../../shared/order.ts';
import { buildPlan, resumePoint, storyResume } from '../../shared/plan.ts';
import { reviewVerdict, threadCounts, understandPages } from '../../shared/understand.ts';
import type { ReviewData, ReviewPatch, ReviewState } from '../../shared/types.ts';

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
    <StatusLine dot="caution" label="Base">
      <span className="font-mono">{data.baseRef}</span> is behind <span className="font-mono">{remote}</span>, so {plural(commits, 'commit')} already there {commits === 1 ? 'counts' : 'count'} as part of this branch.{' '}
      <TextButton disabled={busy} onClick={() => set(remote)}>
        Compare with <span className="font-mono">{remote}</span>
      </TextButton>
    </StatusLine>
  );
}

/** More than one sitting takes in: split it, or read it over several. */
function TooBigLine({ data }: { data: ReviewData }) {
  const [copied, setCopied] = useState(false);
  if (!tooBig({ minutes: data.minutes, steps: data.steps.length })) return null;
  return (
    <StatusLine dot="caution" label="Big change">
      about {formatDuration(data.minutes)} of reading. Smaller branches get a better review.{' '}
      <TextButton
        onClick={async () => {
          await navigator.clipboard.writeText(splitRequest(data.branch, data.steps.length, formatDuration(data.minutes)));
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy a request to split it'}
      </TextButton>
      {copied ? ' (paste it into the agent’s session)' : ''}, or read it over several sittings. Hunkdory keeps your place.
    </StatusLine>
  );
}

/** Uncommitted edits in the branch's folder: review them on their own, or go back to the whole branch. */
function UncommittedLine({ data, onChanged, onError }: { data: ReviewData; onChanged: () => void; onError: (message: string | null) => void }) {
  const { busy, set } = useSetBase(data, onChanged, onError);
  if (!data.dirty || data.pr || (data.uncommitted && !data.baseChosen)) return null;
  const files = plural(data.dirtyFiles, 'file');
  const one = data.dirtyFiles === 1;
  return data.uncommitted ? (
    <StatusLine dot="neutral" label="Only the uncommitted changes">
      on <span className="font-mono">{data.branch}</span>, against its last commit.{' '}
      <TextButton disabled={busy} onClick={() => set(null)}>
        Include its commits
      </TextButton>
    </StatusLine>
  ) : (
    <StatusLine dot="neutral" label={files}>
      {one ? 'isn’t' : 'aren’t'} committed yet and {one ? 'is' : 'are'} part of this review.{' '}
      <TextButton disabled={busy} onClick={() => set(data.branch)}>
        Only {one ? 'that' : 'those'}
      </TextButton>
    </StatusLine>
  );
}

/** The pull request in one line: its reviews, its open threads and CI. It reads first, so it's at body size. */
function GitHubLine({ data, onReviews }: { data: ReviewData; onReviews?: () => void }) {
  if (!data.pr) return null;
  const verdict = reviewVerdict(data.pr.reviews);
  const { open } = threadCounts(data.github, data.hunks);
  const checks = data.pr.checks;
  const failing = checkCounts(checks).fail > 0;
  const parts = [
    <span key="v" className={verdict.tone === 'caution' ? 'text-caution' : verdict.tone === 'ok' ? 'text-ok' : ''}>
      {verdict.text}
    </span>,
    data.github?.threads.length ? (open ? plural(open, 'open thread') : 'every thread resolved') : null,
    checks.length ? (
      <span key="ci" className={failing ? 'text-error' : ''}>
        CI: {checksText(checks)}
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    <StatusLine lead dot={verdict.tone === 'caution' || failing ? 'caution' : verdict.tone === 'ok' ? 'ok' : 'neutral'} label="GitHub">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p}
        </span>
      ))}
      .
      {onReviews && (
        <>
          {' '}
          <TextButton onClick={onReviews}>What reviewers said</TextButton>
        </>
      )}
    </StatusLine>
  );
}

/** Whether the agent ran tests in its session, and whether that still covers its last edit. */
function TestsLine({ data }: { data: ReviewData }) {
  const t = data.agentTests;
  if (!t) return null;
  const last = t.runs.at(-1);
  if (!last) {
    return (
      <StatusLine dot="caution" label="Tests">
        not run in the agent’s session.
      </StatusLine>
    );
  }
  const stale = !!t.lastEditAt && t.lastEditAt > last.at;
  const outcome = { passed: 'passed', failed: 'failed', unknown: 'ran, but the output doesn’t say if they passed,' }[last.result];
  return (
    <StatusLine dot={last.result === 'failed' ? 'error' : last.result === 'passed' && !stale ? 'ok' : 'caution'} label="Tests" data-tooltip={last.command}>
      {outcome} in the agent’s session ({timeAgo(last.at)}).{stale && ' The agent edited files after that run.'}
      {t.runs.length > 1 && ` ${t.runs.length} runs in all.`}
    </StatusLine>
  );
}

function PlanView({ go, data, initialState, onReload }: { go: Go; data: ReviewData; initialState: ReviewState; onReload: () => void }) {
  const [state, setState] = useState(initialState);
  // A new read of the branch knows best, also over what was shown until it came in.
  useEffect(() => setState(initialState), [initialState]);
  const [error, setError] = useState<string | null>(null);
  const [skipSeen, setSkipSeen] = useState(true);
  const [howItWorks, setHowItWorks] = useState(false);
  const plan = useMemo(() => buildPlan(data, state), [data, state.order, state.aiReview]);
  // The pages about the change as a whole, which the review opens with.
  const pages = useMemo(() => understandPages(data, data.github), [data]);
  // Opening a branch without a walkthrough has Hunkdory write one; the steps update when it's ready.
  // Not when a hunkdory:// link opened it: any website can open one, so it waits for you to ask.
  const w = useWalkthroughJob(data, { auto: !openedByLink(data.projectId, data.branch), onDone: onReload });
  // The lines the running pills in the top bar scroll to. Only the page moves: scrollIntoView also shifts the panes around it, top bar included.
  const scroller = useRef<HTMLDivElement>(null);
  const scrollToLine = (kind: 'walkthrough' | 'ai-review') => {
    const page = scroller.current;
    const line = page?.querySelector(`[data-status="${kind}"]`);
    if (page && line) page.scrollTo({ top: page.scrollTop + line.getBoundingClientRect().top - page.getBoundingClientRect().top - 16, behavior: 'smooth' });
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

  const review = (s: ReviewState, to: { stepKey?: string; decision?: string; understand?: string; story?: boolean }) => go({ name: 'review', projectId: data.projectId, branch: data.branch, ...to, preloaded: { data, state: s } });
  const search = useCodeSearch(data, async (key, focus) => {
    const s = await begin();
    if (s) go({ name: 'review', projectId: data.projectId, branch: data.branch, stepKey: key, focus, preloaded: { data, state: s } });
  });
  const toFinish = () => go({ name: 'finish', projectId: data.projectId, branch: data.branch });

  // With a walkthrough there's a story to read, top to bottom. Without one, the plan's order is all there is.
  const nothing = data.steps.length === 0;
  const story = data.walkthrough !== 'skeleton' && !nothing ? storyResume(data, state) : null;
  const storyMode = data.walkthrough !== 'skeleton' && !nothing;
  // The first time in, Start opens the pages about the change; after that it goes on where you left off.
  const briefFirst = (s: ReviewState) => pages.length > 0 && !s.understood?.length;
  /** The pages about the change, from any of them: reading them doesn't start the review. */
  const openPage = (id = pages[0]?.id) => id && review(state, { understand: id, story: storyMode });

  const resume = resumePoint(plan, state);
  const allDone = !needsStart && !resume;
  /** Decisions first, then the steps that need you. `brief`: by way of the pages about the change, the first time. */
  const go1 = async (brief = false) => {
    if (allDone) return toFinish();
    const s = await begin();
    if (!s) return;
    if (brief && briefFirst(s)) return review(s, { understand: pages[0]!.id });
    const r = resumePoint(plan, s);
    if (!r) return toFinish();
    review(s, { decision: r.decision?.id, stepKey: r.stepKey });
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

  const readStory = async () => {
    const s = await begin();
    if (!s) return;
    if (briefFirst(s)) return review(s, { understand: pages[0]!.id, story: true });
    const at = storyResume(data, s);
    if (at) review(s, { story: true, stepKey: at.step.key });
  };
  const primary = story ? readStory : () => go1(true);
  const primaryLabel = story ? (story.started && !needsStart ? `Continue the story: step ${story.at} of ${story.of}` : 'Read the story') : ctaLabel;

  // ⌘↵ starts or continues, ⌘⇧↵ finishes, U opens the pages about the change: the registry's `plan.start`, `review.finish` and `review.understand`.
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
      } else if (matches(e, 'review.understand') && pages.length) {
        e.preventDefault();
        openPage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const unchanged = since?.alreadyReviewed.length ?? 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, shrink: true }]} />
        </div>
        <RunningWork data={data} state={state} onOpen={(kind) => scrollToLine(kind === 'walkthrough' ? 'walkthrough' : 'ai-review')} />
        <PrLink data={data} />
        {search.button}
        <Button variant={allDone ? 'primary' : 'quiet'} shortcut="review.finish" onClick={toFinish}>
          Finish
        </Button>
      </ViewHeader>
      {search.panel}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-6 pt-16 pb-14">
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
              {data.pr && (
                <span>
                  · <TextButton onClick={() => window.api.openExternal(data.pr!.url)}>PR #{data.pr.number}</TextButton>
                </span>
              )}
              <span>· {sizeText(data.files, data.added, data.removed)}</span>
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
              {data.session && <OpenInSeshboard session={data.session} />}
            </span>
            {/* The story first: what this change is, in words, before how much of it there is. */}
            <h1 className="text-hero font-semibold break-words">{data.title}</h1>
            {data.intent ? <p className="text-body select-text">{data.intent}</p> : !nothing && data.walkthrough !== 'skeleton' && <p className="text-body text-muted">The walkthrough has no summary.</p>}
          </div>

          {nothing ? (
            <Notice tone="neutral" actions={<Button size="sm" onClick={toFinish}>Close this review</Button>}>
              <strong className="font-semibold text-text">There's nothing to review here.</strong> This branch has no changes compared with <span className="font-mono">{data.baseRef}</span>: it may be merged already, or its commits cancel each other out.
            </Notice>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" shortcut={allDone ? 'review.finish' : 'plan.start'} onClick={primary}>
                {primaryLabel}
              </Button>
              {story && resume && (plan.decisions.length > 0 || data.steps.length > 1) && (
                <Button size="lg" onClick={() => go1()}>
                  Start with what needs me
                </Button>
              )}
              {data.walkthrough === 'skeleton' && data.assistant && !writing && !w.asking && (
                <Button size="lg" data-tooltip={usageNote(data.assistant)} onClick={w.write}>
                  {w.failed ? 'Try again' : 'Write a walkthrough'}
                </Button>
              )}
              <span className="text-meta text-faint">About {formatDuration(data.minutes)}</span>
            </div>
          )}

          <SendBackStatus data={data} state={state} onFinish={toFinish} />

          {since && counts && (
            <p className="m-0 border-l-[3px] border-unread pl-3 text-body">
              <strong className="font-semibold">Since your last review:</strong>{' '}
              {[counts.changed && `${plural(counts.changed, 'step')} changed`, counts.new && `${plural(counts.new, 'step')} new`, counts.same && `${counts.same} the same`].filter(Boolean).join(', ') || 'nothing changed'}
              {since.gone ? `. ${plural(since.gone, 'earlier change')} ${since.gone === 1 ? 'is' : 'are'} gone.` : '.'}{' '}
              <span className="text-muted">
                You {since.decision.kind === 'send-back' ? 'sent it back' : since.decision.kind === 'github' ? 'reviewed it on GitHub' : 'finished it'} {timeAgo(since.decision.at).toLowerCase()}.
              </span>
              {unchanged > 0 &&
                (skipSeen ? (
                  <>
                    {' '}
                    The {plural(unchanged, 'unchanged step')} {unchanged === 1 ? 'counts' : 'count'} as reviewed. <TextButton onClick={() => setSkipSeen(false)}>Undo</TextButton>
                  </>
                ) : (
                  <>
                    {' '}
                    <TextButton onClick={() => setSkipSeen(true)}>Count the {plural(unchanged, 'unchanged step')} as reviewed</TextButton>
                  </>
                ))}
            </p>
          )}

          <PushToPrNotice data={data} onPushed={onReload} />
          {data.stack && <StackBar data={data} go={go} />}

          {/* What to know before you start, a line each. Each line takes itself out, and with none left so does the block. */}
          <section aria-label="Before you start" className="flex flex-col gap-1.5 border-t border-border pt-5 empty:hidden">
            <GitHubLine data={data} onReviews={pages[0]?.id === 'reviews' ? () => openPage('reviews') : undefined} />
            {!nothing && <WalkthroughStatus data={data} w={w} data-status="walkthrough" />}
            {!nothing && (
              <AiReviewLine data={data} state={state} onSettings={() => go({ name: 'connect', projectId: data.projectId })} data-status="ai-review" />
            )}
            <TestsLine data={data} />
            <UncommittedLine data={data} onChanged={onReload} onError={setError} />
            <StaleBaseLine data={data} onChanged={onReload} onError={setError} />
            {!nothing && <TooBigLine data={data} />}
          </section>

          {!nothing && (
            <p className="m-0 flex flex-wrap items-center gap-x-1 text-meta text-faint">
              New here? <TextButton onClick={() => setHowItWorks(true)}>How a review works</TextButton>
              <span className="shortcut-hint inline-flex items-center gap-x-1">
                · <Kbd shortcut="shortcuts" /> every shortcut
              </span>
            </p>
          )}
          {howItWorks && (
            <Dialog title="How a review works" onClose={() => setHowItWorks(false)}>
              <HowItWorksList data={data} />
            </Dialog>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </main>
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
    ['Know what it’s about', 'Start opens a few pages on the change as a whole: what reviewers said, what was asked and what it did, how it fits together. They stay in the Context panel, and U opens them again.'],
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
