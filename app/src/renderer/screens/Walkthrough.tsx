// The step walkthrough: one step at a time, read top to bottom, with one clear next action.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { ArrowLeft, Check, Columns2, MessageSquare, Rows2 } from 'lucide-react';
import { Crumbs, RiskPill, cleanError, isPlainKey, plural, reviewCrumbs, useMediaQuery, usePref } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { TextButton } from '../components/ui/TextButton.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { matches } from '../lib/shortcuts.ts';
import { DiffHunk, isLine, type Anchor, type DiffMode, type LineRef } from '../components/diff.tsx';
import { GitHubThreadCard, ReviewersSaid, askDraft } from '../components/githubThreads.tsx';
import { placeThreads } from '../../shared/threads.ts';
import { Checks, PrLink, PushToPrNotice, StackBar } from '../components/github.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { findingsView } from '../../shared/aiReview.ts';
import { OUTSIDE_HINT, isReviewed } from '../../shared/order.ts';
import { buildPlan, decisionLabels, resumePoint, settleComment, storyResume, storySteps, type PlanDecision } from '../../shared/plan.ts';
import { askedSummary, reviewVerdict, reviewsSummary, threadCounts, trySummary, understandPages } from '../../shared/understand.ts';
import type { CheckAnswer, Exchange, GitHubThread, HunkView, ReviewData, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';
import { answerLine, lineAsk } from '../../shared/comments.ts';
import { AskPanel, CheckFollowUp, Thread } from '../components/ask.tsx';
import { Markdown } from '../components/markdown.tsx';
import { useCodeSearch } from '../components/search.tsx';
import { AiReviewAside, FindingAtLine, StepFindings } from '../components/aiReview.tsx';
import { RunningWork } from '../components/RunningWork.tsx';
import { AskedPage, FitsPage, StepEffects, TryPage, UnderstandHeader, askedLabel } from '../components/understand.tsx';
import { EmptyStepNotice, WalkthroughBar } from '../components/walkthrough.tsx';
import { StepTraceDialog } from '../components/runLog.tsx';
import { useOnReturn, useTabActive } from '../state/tabPane.ts';
import { AgentChoices, AgentTests, AskedFor, CommentBox, LinkedIssues, NO_TEST_HINT, RiskNote, hasLinkedIssues, whyFallback } from './Review.tsx';
import { OpenInSeshboard } from '../components/OpenInSeshboard.tsx';

export function Walkthrough({ go, data, initialState, stepKey, decision, group, understand, story, focus }: { story?: boolean; go: Go; data: ReviewData; initialState: ReviewState; stepKey?: string; decision?: string; group?: string; understand?: string; focus?: LineRef }) {
  const [state, setState] = useState(initialState);
  const latestState = useRef(state);
  latestState.current = state;
  // A review reads the branch once, so this is how old the diff on screen is. "Show the new diff" remounts it.
  const [loadedAt] = useState(() => new Date().toISOString());
  const plan = useMemo(() => buildPlan(data, state), [data, state.order, state.aiReview]);
  // The story: every step, in the walkthrough's order. Otherwise what needs you first: read closely, then skim.
  const steps = useMemo(() => (story ? storySteps(data) : plan.sequence), [story, data, plan]);
  // Where you are comes from the route, so back and forward move between steps and decisions.
  // Opened without a place ("Continue review"): the first thing not done yet, decisions first.
  const [start] = useState(() => (stepKey || decision || group || understand ? null : resumePoint(plan, state)));
  const startKey = start?.stepKey ?? steps[0]?.key;
  const decisionId = decision ?? (stepKey || understand ? undefined : start?.decision?.id);
  const dec = decisionId ? (plan.decisions.find((d) => d.id === decisionId) ?? null) : null;
  const decPos = dec ? plan.decisions.indexOf(dec) : -1;
  const selKey = dec ? (stepKey && dec.stepKeys.includes(stepKey) ? stepKey : dec.stepKeys[0]) : (stepKey ?? startKey);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // What the Ask box opens with, from a GitHub comment; `n` opens a fresh box for each one. From a line you wrote on, `send` sends it right away.
  const [draft, setDraft] = useState<{ text: string; n: number; send?: Exchange['kind'] } | null>(null);
  // Checking the PR out gives a change somewhere to happen. The code is the same, so the branch isn't read again.
  const [checkedOut, setCheckedOut] = useState<string | null>(null);
  const askData = useMemo<ReviewData>(() => (checkedOut ? { ...data, ask: { ...data.ask, change: { by: 'fresh', where: checkedOut } } } : data), [data, checkedOut]);
  const checkout = async () => setCheckedOut(await window.api.checkoutPullRequest(data.projectId, data.branch));
  // What people said on GitHub, kept here: replying or resolving changes it without reading the branch again.
  const [feedback, setFeedback] = useState(data.github);
  const placed = useMemo(() => placeThreads(feedback?.threads ?? [], data.hunks), [feedback, data.hunks]);
  // The pages about the change as a whole, before the steps. `page` is the one open, if any.
  const pages = useMemo(() => understandPages(data, feedback), [data, feedback]);
  const pageAt = understand ? pages.findIndex((p) => p.id === understand) : -1;
  const page = pageAt < 0 ? null : pages[pageAt]!;
  // Back on this tab after a while: new replies show right away, and new code is yours to bring in, so nothing moves as you read.
  const [moved, setMoved] = useState(false);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  useOnReturn(() => {
    window.api.loadReview(data.projectId, data.branch).then(
      ({ data: now }) => {
        setUnreadable(null);
        if (now.headSha !== data.headSha || now.dirtyFiles !== data.dirtyFiles) setMoved(true);
        else setFeedback(now.github);
      },
      // It can't be read right now: what's on screen stays, and says so, since finishing won't work from here.
      (e) => setUnreadable(cleanError(e))
    );
  });
  // The question you just answered "Needs a change" or "Not sure", so its box takes the focus.
  const [answered, setAnswered] = useState<{ stepKey: string; index: number } | null>(null);
  const [commenting, setCommenting] = useState(false);
  // The step whose "How the agent got here" is open. Also from the skim page, which shows several steps.
  const [tracing, setTracing] = useState<Step | null>(null);
  const [commentKey, setCommentKey] = useState(0);
  const [showContext, setShowContext] = usePref<boolean>('walkthrough-context', true);
  const [mode, setMode] = usePref<DiffMode>('diff-mode', 'unified');
  const [ignoreSpace, setIgnoreSpace] = usePref<boolean>('diff-ignore-space', false);
  const [wrap, setWrap] = usePref<boolean>('diff-wrap', false);
  // Context steps aside when the diff needs the room: side by side, or a narrow window. You can still open it.
  // The pages about the change have no diff, so it stays until the window is narrow.
  const wide = useMediaQuery('(min-width: 1400px)');
  const roomy = useMediaQuery('(min-width: 1000px)');
  const autoHide = understand ? !roomy : mode === 'split' || !wide;
  const [contextOverride, setContextOverride] = useState<boolean | null>(null);
  useEffect(() => setContextOverride(null), [autoHide]);
  const contextShown = contextOverride ?? (showContext && !autoHide);
  const toggleContext = () => {
    setContextOverride(!contextShown);
    if (!autoHide) setShowContext(!contextShown);
  };
  const skimGroup = group ? (plan.skimGroups.find((g) => g.name === group) ?? null) : null;
  const since = useMemo(() => sinceLastRound(data.steps, state), [data.steps, state.rounds]);

  // Answers and Claude's progress arrive while you read.
  useEffect(
    () =>
      window.events.onReviewStateChanged((r) => {
        if (r.projectId === data.projectId && r.branch === data.branch) setState(r);
      }),
    [data.projectId, data.branch]
  );

  const pos = Math.max(0, steps.findIndex((s) => s.key === selKey));
  // A decision without a step, like failing CI, gets a page of its own.
  const cur = dec && !selKey ? undefined : steps[pos];

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

  const at = (to: { stepKey?: string; decision?: string; group?: string; understand?: string; focus?: LineRef }) => go({ name: 'review', projectId: data.projectId, branch: data.branch, story: story && !to.decision && !to.group, ...to });
  const openPage = (id: string) => at({ understand: id });
  const select = (key: string) => at({ stepKey: key });
  const decide = (d: PlanDecision) => at({ decision: d.id, stepKey: d.stepKeys[0] });
  const toPlan = () => go({ name: 'plan', projectId: data.projectId, branch: data.branch });
  const search = useCodeSearch(data, (key, focus) => at({ stepKey: key, focus }));

  // A new place starts with the comment and question boxes closed.
  useEffect(() => {
    setAsking(false);
    setDraft(null);
    setCommenting(false);
    setTracing(null);
  }, [selKey, decision, group, understand]);

  // And at its top: the scroller stays mounted from one place to the next. Search's jump to a line comes after this.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // In braces: scrollTo returns a promise, and an effect may only return its clean-up.
    scroller.current?.scrollTo(0, 0);
  }, [selKey, decision, group, understand]);

  // A page about the change counts as read once you opened it.
  useEffect(() => {
    if (page && !state.understood?.includes(page.id)) void patch({ type: 'understood', page: page.id });
  }, [page?.id]);

  /** After the decisions: the first step you haven't reviewed, or wrap up. */
  const pastDecisions = (s: ReviewState = state) => {
    const open = steps.find((x) => !isReviewed(x, s.reviewed));
    if (open) select(open.key);
    else go({ name: 'finish', projectId: data.projectId, branch: data.branch });
  };
  const nextDecision = () => (plan.decisions[decPos + 1] ? decide(plan.decisions[decPos + 1]) : pastDecisions());
  /** Past the pages about the change: where the plan's Start goes, the story's next step or the first decision. */
  const target = story ? storyResume(data, state) : resumePoint(plan, state);
  const intoReview = () => {
    if (!target) return go({ name: 'finish', projectId: data.projectId, branch: data.branch });
    if ('step' in target) return select(target.step.key);
    if (target.decision) return decide(target.decision);
    select(target.stepKey);
  };
  const intoLabel = (() => {
    if (!target) return 'Finish the review';
    if ('step' in target) return target.started ? `Continue the story: step ${target.at} of ${target.of}` : 'Read the story';
    const verb = Object.keys(state.reviewed).length || Object.keys(state.settled ?? {}).length ? 'Continue' : 'Start';
    if (target.decision) return `${verb}: decision ${plan.decisions.indexOf(target.decision) + 1} of ${plan.decisions.length}`;
    return `${verb}: step ${plan.sequence.findIndex((s) => s.key === target.stepKey) + 1} of ${plan.sequence.length}`;
  })();
  const nextPage = () => (pages[pageAt + 1] ? openPage(pages[pageAt + 1]!.id) : intoReview());
  const prevPage = () => (pageAt > 0 ? openPage(pages[pageAt - 1]!.id) : toPlan());
  const prevDecision = () => (decPos > 0 ? decide(plan.decisions[decPos - 1]) : toPlan());
  const keys = useRef({ looksGood: () => { }, groupDone: () => { } });

  // The review's keys, from the registry: j and k move, r says it looks good (or gives a decision its main
  // answer), n needs a fix, c comments, a asks Claude, s and w change the diff, Esc goes back to the plan.
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      // The dialog has the keys while it's open: Esc closes it instead of leaving for the plan.
      if (!isPlainKey(e) || tracing) return;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (matches(e, 'review.plan')) return run(toPlan);
      if (matches(e, 'review.finish')) return run(() => go({ name: 'finish', projectId: data.projectId, branch: data.branch }));
      if (matches(e, 'review.layout')) return run(() => setMode(mode === 'split' ? 'unified' : 'split'));
      if (matches(e, 'review.whitespace')) return run(() => setIgnoreSpace(!ignoreSpace));
      if (matches(e, 'review.wrap') && mode !== 'split') return run(() => setWrap(!wrap));
      if (matches(e, 'review.understand') && pages.length) return run(() => openPage(pages[0]!.id));
      if (page) {
        if (matches(e, 'review.context')) return run(toggleContext);
        if (matches(e, 'review.next') || matches(e, 'review.understandNext')) return run(nextPage);
        if (matches(e, 'review.previous')) return run(prevPage);
        return;
      }
      if (skimGroup) {
        if (matches(e, 'review.good')) run(() => keys.current.groupDone());
        return;
      }
      if (!cur && !dec) return;
      if (matches(e, 'review.context') && cur) return run(toggleContext);
      // While deciding, next and back go through the decisions.
      if (matches(e, 'review.next')) return run(dec ? nextDecision : () => pos < steps.length - 1 && select(steps[pos + 1].key));
      if (matches(e, 'review.previous')) return run(dec ? prevDecision : () => pos > 0 && select(steps[pos - 1].key));
      if (matches(e, 'review.good')) return run(dec ? () => (state.settled?.[dec.id] ? nextDecision() : settle(dec, 'fine')) : () => keys.current.looksGood());
      if (matches(e, 'review.fix') && dec && !state.settled?.[dec.id]) return run(() => settle(dec, 'fix'));
      if (matches(e, 'review.comment') && cur) return run(openComment);
      if (matches(e, 'review.ask') && cur && data.ask.question.by) return run(openAsk);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openComment = () => {
    setCommenting(true);
    setTimeout(() => (document.querySelector('[data-tab-active] #feedback') as HTMLElement | null)?.focus(), 0);
  };
  const openAsk = () => {
    setAsking(true);
    setTimeout(() => {
      const box = document.querySelector('[data-tab-active] [aria-label="Your question or change"]') as HTMLTextAreaElement | null;
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
    }, 0);
  };
  const askAbout = (t: GitHubThread, kind: 'question' | 'change') => {
    setDraft({ text: askDraft(t, kind), n: Date.now() });
    openAsk();
  };
  /** The GitHub threads on one line of a hunk. Asking about one needs a step: the skim page has none. */
  const threadsAt = (hunkId: string, ask: boolean) => (a: Anchor) => {
    const list = (placed.byHunk.get(hunkId) ?? []).filter((t) => t.side === a.side && t.line === a.line);
    return list.length
      ? list.map((t) => <GitHubThreadCard key={t.id} data={askData} thread={t} onFeedback={(f) => f && setFeedback(f)} onAsk={ask ? (kind) => askAbout(t, kind) : undefined} />)
      : null;
  };

  /** What goes under a line of the diff: its GitHub threads, then what the AI review said about it. */
  const openFindings = findingsView(state.aiReview?.result, data, state.comments).open;
  const extrasAt = (hunkId: string, ask: boolean) => (a: Anchor) => {
    const threads = threadsAt(hunkId, ask)(a);
    const found = openFindings.filter(({ finding: f }) => f.hunkId === hunkId && f.side === a.side && f.line === a.line);
    if (!found.length) return threads;
    return (
      <>
        {threads}
        {found.map((item) => (
          <FindingAtLine key={item.finding.id} data={data} item={item} act={actOn} onAsk={ask ? askWith : undefined} />
        ))}
      </>
    );
  };
  const actOn = (p: Extract<ReviewPatch, { type: 'ai-finding' }>) => void patch(p);
  /** Fills in the Ask box, for you to read and send. */
  const askWith = (text: string) => {
    setDraft({ text, n: Date.now() });
    openAsk();
  };
  /** What you wrote on a line goes to the assistant as is. A change with nowhere to happen yet waits in the box, which can check the PR out. */
  const askFromLine = (h: HunkView) =>
    data.ask.question.by
      ? (a: Anchor, body: string, kind: Exchange['kind']) => {
          setDraft({ text: lineAsk(a.side === 'LEFT' ? (h.oldPath ?? h.path) : h.path, a, body), n: Date.now(), send: kind === 'question' || askData.ask.change.by ? kind : undefined });
          openAsk();
        }
      : undefined;

  /** One change's box: ticks it off within its step. */
  const tick = (s: Step, hunkId: string) => ({
    reviewed: !!state.reviewed[s.key]?.includes(hunkId),
    onReviewed: (on: boolean) => void patch({ type: 'reviewed-hunk', stepKey: s.key, hunkIds: s.hunkIds, hunkId, on }),
  });
  const openThreads = (hunkId: string) => (placed.byHunk.get(hunkId) ?? []).filter((t) => !t.resolved).length;

  const careful = !!cur && plan.careful.some((s) => s.key === cur.key);

  const settle = async (d: PlanDecision, value: 'fine' | 'fix' | null) => {
    const comment = settleComment(d, cur?.key);
    let next = await patch({ type: 'settle', id: d.id, value, comment });
    if (!next) return;
    // Deciding next to the code is reviewing it: the step doesn't come back later as one to read.
    if (value && cur && d.stepKeys.includes(cur.key) && !isReviewed(cur, next.reviewed)) {
      next = (await patch({ type: 'reviewed', stepKey: cur.key, hunkIds: cur.hunkIds, on: true })) ?? next;
    }
    // The step's comment box shows what was added; say more there before moving on.
    if (value === 'fix' && comment?.stepKey) {
      setCommentKey((k) => k + 1);
      setCommenting(true);
      return;
    }
    // Deciding the decision you came for moves you on, like a wizard.
    if (value && dec?.id === d.id) {
      const after = [...plan.decisions.slice(decPos + 1), ...plan.decisions.slice(0, decPos)].find((x) => !next.settled?.[x.id]);
      if (after) decide(after);
      else pastDecisions(next);
    }
  };

  const segs = (list: Step[]) => list.map((s) => ({ key: s.key, title: `Step ${s.index + 1}: ${s.title}`, done: isReviewed(s, state.reviewed), needsFix: false, current: !page && !dec && s.key === cur?.key, onClick: () => select(s.key) }));
  const firstOf = (list: Step[]) => list.find((s) => !isReviewed(s, state.reviewed)) ?? list[0];
  // A page counts as done once you opened it.
  const understandPhase = {
    label: 'Understand',
    now: !!page,
    onClick: () => openPage(pages[0]!.id),
    segments: pages.map((p) => ({ key: `understand:${p.id}`, title: p.label, done: !!state.understood?.includes(p.id), needsFix: false, current: p.id === page?.id, onClick: () => openPage(p.id) })),
  };
  const phases = [understandPhase, ...(story ? [{ label: 'The story', now: !page && !!cur, onClick: () => select(firstOf(steps).key), segments: segs(steps) }] : [
    {
      label: 'Decide',
      now: !page && !!dec,
      onClick: () => decide(plan.decisions.find((d) => !state.settled?.[d.id]) ?? plan.decisions[0]),
      segments: plan.decisions.map((d) => ({ key: d.id, title: d.title, done: !!state.settled?.[d.id], needsFix: state.settled?.[d.id] === 'fix', current: !page && d.id === dec?.id, onClick: () => decide(d) })),
    },
    { label: 'Read closely', now: !page && !dec && careful, onClick: () => select(firstOf(plan.careful).key), segments: segs(plan.careful) },
    { label: 'Skim', now: !page && !dec && !!cur && !careful, onClick: () => select(firstOf(plan.skim).key), segments: segs(plan.skim) },
  ])].filter((p) => p.segments.length > 0);

  const phaseList = careful ? plan.careful : plan.skim;
  const here = page
    ? `Understand · ${pageAt + 1} of ${pages.length}`
    : skimGroup
    ? `Skim · ${skimGroup.name}`
    : dec
      ? `Decision ${decPos + 1} of ${plan.decisions.length}`
      : cur
        ? story
          ? `The story · step ${steps.findIndex((s) => s.key === cur.key) + 1} of ${steps.length}`
          : `${careful ? 'Read closely' : 'Skim'} · step ${phaseList.findIndex((s) => s.key === cur.key) + 1} of ${phaseList.length}`
        : '';

  const allDone = steps.every((x) => isReviewed(x, state.reviewed)) && plan.decisions.every((d) => state.settled?.[d.id]);
  const nowPhase = phases.find((p) => p.now);

  // One segment per decision or step, under the crumbs: click one to go there.
  const progressBar = (
    <nav aria-label="Review progress" className="flex min-w-0 items-center gap-2.5">
      {phases.map((p) => {
        const n = p.segments.length;
        const done = p.segments.filter((x) => x.done).length;
        return (
          <span key={p.label} data-tooltip={`${p.label} · ${done} of ${n} done`} className="flex min-w-0 gap-0.5" style={{ flex: `${Math.max(2, Math.min(n, 12))} 1 60px` }}>
            {n <= 40 ? (
              p.segments.map((x) => (
                <button key={x.key} type="button" data-tooltip={x.title} aria-label={x.done ? `${x.title}, done` : x.title} aria-current={x.current ? 'step' : undefined} onClick={x.onClick} className="flex h-3 min-w-0 flex-1 items-center">
                  {/* The colour is how far it got, the height is where you are: a step you went back to shows both. */}
                  <span className={`block w-full rounded-full ${x.current ? 'h-1.5' : 'h-1'} ${x.needsFix ? 'bg-text' : x.done ? 'bg-ok' : x.current ? 'bg-faint' : 'bg-selected'}`} />
                </button>
              ))
            ) : (
              <button type="button" onClick={p.onClick} aria-label={`${p.label}: ${done} of ${n} done`} className="flex-1 py-1">
                <span className="block h-1 rounded-full" style={{ background: `linear-gradient(to right, var(--sb-ok) ${(done / n) * 100}%, var(--sb-selected) 0)` }} />
              </button>
            )}
          </span>
        );
      })}
      {nowPhase && (
        <span className="shrink-0 text-meta whitespace-nowrap text-faint">
          {nowPhase.label} · {nowPhase.segments.filter((x) => x.done).length} of {nowPhase.segments.length}
        </span>
      )}
    </nav>
  );

  // Crumbs, progress and actions in one bar, so the diff gets the height. Finish stays quiet until everything is done.
  const header = (
    <ViewHeader>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
        <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, onClick: toPlan, shrink: true }, { label: here }]} />
        {progressBar}
      </div>
      {/* Without a walkthrough, WalkthroughBar right below says it's being written. */}
      <RunningWork data={data} state={state} onOpen={toPlan} noWalkthrough={data.walkthrough === 'skeleton'} />
      <PrLink data={data} />
      {search.button}
      <Button variant="quiet" icon={<ArrowLeft size={13} aria-hidden />} shortcut="review.plan" onClick={toPlan}>
        Plan
      </Button>
      {(page || (cur && !skimGroup)) && (
        <Button variant="quiet" selected={contextShown} aria-pressed={contextShown} shortcut="review.context" onClick={toggleContext}>
          Context
        </Button>
      )}
      <Button variant={allDone ? 'primary' : 'quiet'} shortcut="review.finish" onClick={() => go({ name: 'finish', projectId: data.projectId, branch: data.branch })}>
        Finish
      </Button>
    </ViewHeader>
  );

  // The decision you came for sits in the footer, where "Looks good" is for a step: in reach after reading the code.
  const decided = dec ? state.settled?.[dec.id] : undefined;
  const decLabels = dec ? decisionLabels(dec) : null;
  const decisionActions =
    dec &&
    decLabels &&
    (decided ? (
      <>
        <span className="text-ui font-semibold">✓ {decided === 'fine' ? decLabels.fineDone : decLabels.fixDone}</span>
        <Button variant="quiet" onClick={() => settle(dec, null)}>
          Change
        </Button>
        <Button variant="primary" size="lg" shortcut="review.good" onClick={nextDecision}>
          {plan.decisions[decPos + 1] ? 'Next decision' : 'On to the steps'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="quiet" onClick={nextDecision}>
          Decide later
        </Button>
        <Button size="lg" shortcut="review.fix" onClick={() => settle(dec, 'fix')}>
          {decLabels.fix}
        </Button>
        <Button variant="primary" size="lg" shortcut="review.good" onClick={() => settle(dec, 'fine')}>
          {decLabels.fine}
        </Button>
      </>
    ));

  const footer = (children: React.ReactNode) => (
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-border px-6 py-2.5">
      {children}
      <span className="shortcut-hint ml-2 flex items-center gap-1.5 text-meta text-faint">
        <Kbd shortcut="shortcuts" /> every shortcut
      </span>
    </footer>
  );

  const traceLink = (s: Step) =>
    data.sessionCount > 0 &&
    s.files.length > 0 && (
      <button type="button" className="self-start text-ui text-link hover:underline" onClick={() => setTracing(s)}>
        How the agent got here
      </button>
    );

  const shell = (body: React.ReactNode, foot: React.ReactNode, aside?: React.ReactNode) => (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {header}
      <WalkthroughBar data={data} onSwitch={() => go({ name: 'review', projectId: data.projectId, branch: data.branch, story, reload: Date.now() })} />
      {moved && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-link/30 bg-link/8 px-6 py-1.5 text-meta text-text">
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">This branch changed while you were away.</strong> You're still looking at the diff from when you opened it.
          </span>
          <Button size="sm" variant="primary" onClick={() => go({ name: 'review', projectId: data.projectId, branch: data.branch, story, stepKey: selKey, decision: dec?.id, group, reload: Date.now() })}>
            Show the new diff
          </Button>
        </div>
      )}
      {unreadable && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-caution/30 bg-caution/8 px-6 py-1.5 text-meta text-text">
          <span className="min-w-0 flex-1 truncate" data-tooltip={unreadable}>
            <strong className="font-semibold">Hunkdory can't read this branch right now.</strong> {unreadable} What's on screen is from before, and finishing the review may not work. Your comments are saved.
          </span>
          <Button size="sm" onClick={() => go({ name: 'home' })}>
            Back to the inbox
          </Button>
        </div>
      )}
      {search.panel}
      <div className="flex min-h-0 flex-1">
        <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {body}
        </div>
        {aside}
      </div>
      {footer(foot)}
      {tracing && (
        <StepTraceDialog
          projectId={data.projectId}
          branch={data.branch}
          title={tracing.title}
          // A renamed file was edited under either name.
          files={[...new Set(tracing.hunkIds.flatMap((id) => [data.hunks[id]?.path, data.hunks[id]?.oldPath]).filter((f): f is string => !!f))]}
          onClose={() => setTracing(null)}
        />
      )}
    </div>
  );

  // The Context panel, next to a step and on the pages about the change: those pages, what was asked, the PR,
  // and what checked the work. `long` shows more of the request, before you've read any of the change.
  const contextAside = (long: boolean) => {
    if (!contextShown) return null;
    const verdict = data.pr && reviewVerdict(data.pr.reviews);
    const threads = threadCounts(feedback, data.hunks);
    return (
      <aside aria-label="Context" className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-sidebar px-4 py-5">
        {pages.length > 0 && (
          <section className="flex flex-col gap-0.5">
            <SectionHeader as="h3" className="mb-1">
              About this change
            </SectionHeader>
            {pages.map((p) => {
              const current = p.id === page?.id;
              const seen = !!state.understood?.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => openPage(p.id)}
                  className={`-mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-left text-ui hover:bg-border/45 ${current ? 'bg-selected font-semibold' : ''}`}
                >
                  <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${seen ? 'bg-ok' : current ? 'bg-text' : 'bg-faint'}`} />
                  <span className="min-w-0 break-words">{p.label}</span>
                  {seen && <span className="sr-only">, read</span>}
                </button>
              );
            })}
            <span className="mt-1 text-meta text-faint">Here on every step, so you can look back any time.</span>
          </section>
        )}
        <section className="flex flex-col gap-1.5">
          <SectionHeader as="h3">{askedLabel(data)}</SectionHeader>
          <AskedFor data={data} clamp={long ? 400 : 160} />
          {data.session && (
            <button type="button" className="self-start text-ui text-link hover:underline" onClick={() => window.api.openSessionFile(data.session!.file)}>
              Open the agent session
            </button>
          )}
          {data.session && <OpenInSeshboard session={data.session} className="self-start text-ui" />}
        </section>
        {hasLinkedIssues(data) && (
          <section className="flex flex-col gap-1.5">
            <SectionHeader as="h3">Linked issues</SectionHeader>
            <LinkedIssues data={data} clamp={240} />
          </section>
        )}
        {data.pr && verdict && (
          <section className="flex flex-col gap-1.5 text-ui">
            <SectionHeader as="h3">On GitHub</SectionHeader>
            <span>
              <TextButton onClick={() => window.api.openExternal(data.pr!.url)}>PR #{data.pr.number} ↗</TextButton> · <span className={verdict.tone === 'caution' ? 'text-caution' : verdict.tone === 'ok' ? 'text-ok' : 'text-muted'}>{verdict.text}</span>
            </span>
            {feedback && feedback.threads.length > 0 && (
              <span className="text-muted">{threads.open ? `${plural(threads.open, 'open thread')}${threads.elsewhere ? `, ${threads.elsewhere} not on a line here` : ''}.` : 'Every thread is resolved.'}</span>
            )}
            <Checks data={data} />
            {pages.some((p) => p.id === 'reviews') && page?.id !== 'reviews' && (
              <TextButton className="self-start" onClick={() => openPage('reviews')}>
                What reviewers said
              </TextButton>
            )}
          </section>
        )}
        <AiReviewAside data={data} state={state} />
        {data.agentTests && (
          <section className="flex flex-col gap-1.5 text-ui">
            <SectionHeader as="h3">The agent’s tests</SectionHeader>
            <AgentTests data={data} />
          </section>
        )}
        {data.stack && <StackBar data={data} go={go} layout="column" />}
      </aside>
    );
  };

  // A page about the change as a whole: one at a time, then on into the review.
  if (page) {
    const last = pageAt === pages.length - 1;
    const summary =
      page.id === 'reviews' ? reviewsSummary(feedback!, data.hunks) : page.id === 'asked' ? askedSummary(data) : page.id === 'fits' ? (data.diagram?.summary ?? 'What to know before you read the code.') : trySummary(data);
    const openStep = (x: Step) => select(x.key);
    return shell(
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8">
        <UnderstandHeader title={page.title} summary={summary} />
        {page.id === 'reviews' && feedback && (
          <ReviewersSaid data={askData} feedback={feedback} onFeedback={(f) => f && setFeedback(f)} onOpen={(x, t) => at({ stepKey: x.key, focus: { path: t.path, line: t.line ?? undefined, side: t.side } })} />
        )}
        {page.id === 'asked' && <AskedPage data={data} onOpen={openStep} />}
        {page.id === 'fits' && <FitsPage data={data} onOpen={openStep} />}
        {page.id === 'try' && <TryPage data={data} onOpen={openStep} />}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button variant="primary" size="lg" shortcut="review.understandNext" onClick={nextPage}>
            {last ? intoLabel : `Next: ${pages[pageAt + 1]!.label.toLowerCase()}`}
          </Button>
          {!last && target && (
            <Button variant="quiet" size="lg" onClick={intoReview}>
              {'decision' in target && target.decision ? 'Skip to the decisions' : 'Skip to the steps'}
            </Button>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </main>,
      null,
      contextAside(true)
    );
  }

  // A skim folder on one page: every low-risk step in it, and one action for all of them.
  if (skimGroup) {
    const groupSteps = skimGroup.steps;
    const left = groupSteps.filter((x) => !isReviewed(x, state.reviewed));
    const groupDone = (keys.current.groupDone = async () => {
      let next: ReviewState = state;
      for (const x of left) {
        const r = await patch({ type: 'reviewed', stepKey: x.key, hunkIds: x.hunkIds, on: true });
        if (!r) return;
        next = r;
      }
      // On to the next folder with something left, then any step left, then wrap up.
      const after = plan.skimGroups.find((g) => g.steps.some((x) => !isReviewed(x, next.reviewed)));
      if (after) return at({ group: after.name });
      const open = steps.find((x) => !isReviewed(x, next.reviewed));
      if (open) select(open.key);
      else go({ name: 'finish', projectId: data.projectId, branch: data.branch });
    });
    return shell(
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-7">
        <div className="flex flex-col gap-1.5">
          <span className="text-meta text-faint">
            Skim · {plural(groupSteps.length, 'low-risk step')} · {plural(skimGroup.files, 'file')}
            {left.length < groupSteps.length ? ` · ${groupSteps.length - left.length} already reviewed` : ''}
          </span>
          <h1 className="font-mono text-hero font-semibold break-all">{skimGroup.name}</h1>
          <p className="text-body text-muted">Everything low risk in this folder, on one page. Scroll through, comment on a line where something looks off, then mark the whole folder reviewed.</p>
        </div>
        <DiffToolbar mode={mode} setMode={setMode} ignoreSpace={ignoreSpace} setIgnoreSpace={setIgnoreSpace} wrap={wrap} setWrap={setWrap} />
        {groupSteps.map((x) => (
          <section key={x.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-title font-semibold break-words">
                Step {x.index + 1}: {x.title}
              </h2>
              <RiskPill risk={x.risk} />
              {x.noTestChange && <Pill tone="muted" data-tooltip={NO_TEST_HINT}>No test changed</Pill>}
              {isReviewed(x, state.reviewed) && <Pill tone="muted">Reviewed</Pill>}
            </div>
            {x.why && <p className="text-body text-text select-text">{x.why}</p>}
            {traceLink(x)}
            <StepEffects step={x} />
            <StepFindings data={data} state={state} step={x} act={actOn} />
            {x.riskNote && <RiskNote text={x.riskNote} />}
            {x.choices.length > 0 && <AgentChoices choices={x.choices} by={data.walkthrough} />}
            {x.hunkIds.map((id) => {
              const h = data.hunks[id];
              return h ? (
                <DiffHunk
                  key={id}
                  hunk={h}
                  mode={mode}
                  ignoreSpace={ignoreSpace}
                  wrap={wrap}
                  comments={state.comments.filter((c) => c.hunkId === id && c.line)}
                  onComment={(a, body, cid) => patch({ type: 'line-comment', id: cid, stepKey: x.key, hunkId: id, path: h.path, line: a.line, side: a.side, body })}
                  extraAt={extrasAt(id, false)}
                  threads={openThreads(id)}
                  {...tick(x, id)}
                  loadLines={(side, from, to) => window.api.fileLines(data.projectId, data.branch, side === 'old' ? (h.oldPath ?? h.path) : h.path, side, from, to)}
                  noteBy={data.walkthrough === 'reviewer' ? 'reviewer' : 'agent'}
                />
              ) : null;
            })}
          </section>
        ))}
        {error && <Notice tone="error">{error}</Notice>}
      </main>,
      <>
        <Button size="lg" shortcut="review.plan" onClick={toPlan}>
          Plan
        </Button>
        <Button variant={left.length ? 'primary' : 'secondary'} size="lg" shortcut="review.good" onClick={groupDone}>
          {left.length ? `All ${plural(groupSteps.length, 'step')} look good` : 'Reviewed, next'}
        </Button>
      </>
    );
  }

  if (dec && !cur) {
    const failing = data.pr?.checks.find((c) => c.state === 'fail' && c.url);
    return shell(
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-7">
        <span className="text-meta text-faint">
          Decision {decPos + 1} of {plan.decisions.length}
        </span>
        <h1 className="text-hero font-semibold break-words">{dec.title}</h1>
        <p className="text-body text-text select-text">{dec.detail}</p>
        {dec.places.length > 1 && (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-ui text-muted">
            {dec.places.map((p, i) => (
              <li key={i} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        )}
        {dec.kind === 'ci' && data.pr && (
          <Button className="self-start" onClick={() => window.api.openExternal(failing?.url ?? data.pr!.url)}>
            Open checks ↗
          </Button>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </main>,
      <>
        <Button size="lg" shortcut="review.previous" onClick={prevDecision}>
          Back
        </Button>
        {decisionActions}
      </>
    );
  }

  if (!cur) {
    return shell(<p className="p-6 text-body text-muted">This branch has no changes to review.</p>, null);
  }

  const done = isReviewed(cur, state.reviewed);
  const allExchanges = (state.exchanges ?? []).filter((e) => e.stepKey === cur.key);
  // Follow-ups on one of the step's questions show under that question.
  const stepExchanges = allExchanges.filter((e) => e.check === undefined);
  const earlier = since?.earlierComments[cur.key] ?? [];
  const stepComment = state.comments.find((c) => c.stepKey === cur.key && !c.line)?.body ?? '';
  // The decision you came for first.
  const stepFlags = [...plan.decisions, ...plan.notes].filter((d) => d.stepKeys.includes(cur.key)).sort((a, b) => Number(b.id === dec?.id) - Number(a.id === dec?.id));
  const answers = state.answers?.[cur.key] ?? {};
  const answerNotes = state.answerNotes?.[cur.key] ?? {};
  // The comment box opens by itself only for what you wrote there: the lines your answers add show under their questions.
  const answerLines = new Set(cur.checks.map((q, i) => answerLine(q, answers[i] ?? null, answerNotes[i])).filter(Boolean));
  const ownComment = stepComment.split('\n').some((l) => l.trim() && !answerLines.has(l.trim()));
  const lineComment = (hunkId: string, path: string) => (a: { side: 'LEFT' | 'RIGHT'; line: number }, body: string, id?: string) =>
    patch({ type: 'line-comment', id, stepKey: cur.key, hunkId, path, line: a.line, side: a.side, body });

  const looksGood = (keys.current.looksGood = async () => {
    if (done) {
      if (pos < steps.length - 1) select(steps[pos + 1].key);
      return;
    }
    const next = await patch({ type: 'reviewed', stepKey: cur.key, hunkIds: cur.hunkIds, on: true });
    if (!next) return;
    // Next open step after this one, then any before it. All done: wrap up.
    const open = [...steps.slice(pos + 1), ...steps.slice(0, pos)].find((s) => !isReviewed(s, next.reviewed));
    if (open) select(open.key);
    else go({ name: 'finish', projectId: data.projectId, branch: data.branch });
  });

  // Answering changes the step's comment, so an open comment box starts again from the saved one.
  const answer = async (index: number, value: CheckAnswer) => {
    const next = answers[index] === value ? null : value;
    await patch({ type: 'answer', stepKey: cur.key, index, question: cur.checks[index], value: next, note: answerNotes[index] });
    setCommentKey((k) => k + 1);
    setAnswered(next === 'no' || next === 'unsure' ? { stepKey: cur.key, index } : null);
  };
  // A note box saves when it closes; once you picked another answer that save must not bring "Needs a change" back.
  const saveNote = (key: string, index: number, question: string) => async (note: string) => {
    if (latestState.current.answers?.[key]?.[index] !== 'no') return;
    await patch({ type: 'answer', stepKey: key, index, question, value: 'no', note });
    setCommentKey((k) => k + 1);
  };
  // You weren't sure, then asked for a change: that's your answer now.
  const changeAsked = (key: string, index: number, question: string) => async (note: string) => {
    await patch({ type: 'answer', stepKey: key, index, question, value: 'no', note });
    setCommentKey((k) => k + 1);
    setAnswered({ stepKey: key, index });
  };
  const showChanges = () => go({ name: 'review', projectId: data.projectId, branch: data.branch, story, stepKey: cur.key, reload: Date.now() });


  const changedSince = since?.byStep[cur.key];
  const ticked = cur.hunkIds.filter((id) => state.reviewed[cur.key]?.includes(id)).length;
  const stepThreads = cur.hunkIds.flatMap((id) => placed.byHunk.get(id) ?? []).filter((t) => !t.resolved).length;
  // Where search sent you: the hunk with that line, else the file's first hunk in this step.
  const inFile = (id: string) => !!focus && (data.hunks[id]?.path === focus.path || data.hunks[id]?.oldPath === focus.path);
  const hasLine = (id: string) => focus?.line != null && !!data.hunks[id]?.lines.some((l) => isLine(l, focus.line!, focus.side));
  const focusIn = focus ? (cur.hunkIds.find((id) => inFile(id) && hasLine(id)) ?? cur.hunkIds.find(inFile)) : undefined;
  return shell(
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-7">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <RiskPill risk={cur.risk} />
          {cur.outsideTask && <Pill data-tooltip={OUTSIDE_HINT}>Outside your request</Pill>}
          {cur.noTestChange && <Pill tone="muted" data-tooltip={NO_TEST_HINT}>No test changed</Pill>}
          {done && <Pill tone="muted">Reviewed</Pill>}
          {changedSince && changedSince !== 'same' && <Pill tone="link">{changedSince === 'new' ? 'New' : 'Changed'} since your last review</Pill>}
          {stepThreads > 0 && (
            <Pill tone="link" icon={<MessageSquare size={12} aria-hidden />} data-tooltip="Open review threads on GitHub, shown at their lines below">
              {plural(stepThreads, 'comment')} on GitHub
            </Pill>
          )}
        </div>
        <h1 className="text-hero font-semibold break-words">{cur.title}</h1>
        <p className={`text-body select-text ${cur.why ? 'text-text' : 'text-muted'}`}>{cur.why || whyFallback(cur, data)}</p>
        {traceLink(cur)}
      </div>

      <StepEffects step={cur} />

      <StepFindings
        data={data}
        state={state}
        step={cur}
        act={actOn}
        onAsk={askWith}
      />

      {cur.riskNote && <RiskNote text={cur.riskNote} />}

      {cur.choices.length > 0 && <AgentChoices choices={cur.choices} by={data.walkthrough} />}

      {stepFlags.map((f) => {
        const labels = decisionLabels(f);
        const value = state.settled?.[f.id];
        const current = f.id === dec?.id;
        return (
          <Notice
            key={f.id}
            tone={current ? 'warn' : 'caution'}
            role="note"
            actions={
              current ? undefined : value ? (
                <>
                  <span className="text-ui font-semibold">✓ {value === 'fine' ? labels.fineDone : labels.fixDone}</span>
                  <Button variant="quiet" size="sm" onClick={() => settle(f, null)}>
                    Change
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => settle(f, 'fine')}>
                    {labels.fine}
                  </Button>
                  <Button size="sm" onClick={() => settle(f, 'fix')}>
                    {labels.fix}
                  </Button>
                </>
              )
            }
          >
            <strong className="font-semibold">{f.title}.</strong> {f.detail}
            {current && <span className="block text-meta text-muted">Read the change, then decide below.</span>}
            {current && f.stepKeys.length > 1 && (
              <span className="mt-1 flex flex-wrap gap-2 text-meta">
                In
                {f.stepKeys.map((k) => {
                  const st = data.steps.find((x) => x.key === k);
                  return st ? (
                    <button key={k} type="button" aria-current={k === cur.key ? 'step' : undefined} className={`text-link hover:underline ${k === cur.key ? 'font-semibold' : ''}`} onClick={() => at({ decision: f.id, stepKey: k })}>
                      step {st.index + 1}
                    </button>
                  ) : null;
                })}
              </span>
            )}
          </Notice>
        );
      })}

      {earlier.length > 0 && (
        <Notice tone="info">
          <strong className="font-semibold">What you said here last time</strong>
          {earlier.map((c) => (
            <div key={c.id} className="break-words select-text">
              {c.path && c.line ? <span className="font-mono text-meta text-muted">{`${c.path}:${c.line}`}</span> : null}
              <Markdown text={c.body} />
            </div>
          ))}
        </Notice>
      )}

      {!cur.hunkIds.length && (
        <EmptyStepNotice data={data} onReload={() => go({ name: 'review', projectId: data.projectId, branch: data.branch, story, stepKey: cur.key, reload: Date.now() })} onOpenStep={select} />
      )}

      {cur.hunkIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-faint">
              {plural(cur.files.length, 'file')} · {plural(cur.hunkIds.length, 'change')}
              {ticked > 0 && ` · ${ticked} reviewed`}
            </span>
            {/* With more than one file, a chip per file jumps to its first change. */}
            {cur.files.length > 1 &&
              cur.files.map((f) => {
                const first = cur.hunkIds.find((id) => data.hunks[id]?.path === f);
                return first ? (
                  <Pill key={f} tone="muted" className="font-mono" data-tooltip={f} onClick={() => document.querySelector(`[data-tab-active] [id="hunk-${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {f.split('/').pop()}
                  </Pill>
                ) : null;
              })}
          </span>
          <DiffToolbar mode={mode} setMode={setMode} ignoreSpace={ignoreSpace} setIgnoreSpace={setIgnoreSpace} wrap={wrap} setWrap={setWrap} />
        </div>
      )}

      {cur.hunkIds.map((id) => {
        const h = data.hunks[id];
        if (!h) return null;
        const isNew = since && !since.before.has(id);
        return (
          <div key={`${cur.key}:${id}`} id={`hunk-${id}`} className="scroll-mt-3">
            <DiffHunk
              hunk={h}
              mode={mode}
              ignoreSpace={ignoreSpace}
              wrap={wrap}
              comments={state.comments.filter((c) => c.hunkId === id && c.line)}
              onComment={lineComment(id, h.path)}
              onAsk={askFromLine(h)}
              extraAt={extrasAt(id, true)}
              threads={openThreads(id)}
              startOpen={!!dec}
              {...tick(cur, id)}
              loadLines={(side, from, to) => window.api.fileLines(data.projectId, data.branch, side === 'old' ? (h.oldPath ?? h.path) : h.path, side, from, to)}
              collapsed={since?.reviewedBefore.has(id) ? 'You reviewed this exact change last time.' : null}
              badge={isNew ? <Pill tone="link">New since your last review</Pill> : null}
              noteBy={data.walkthrough === 'reviewer' ? 'reviewer' : 'agent'}
              focus={id === focusIn ? focus : undefined}
            />
          </div>
        );
      })}

      {cur.checks.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeader as="h2" count={cur.checks.length}>
            {cur.checks.length === 1 ? 'A question for you' : 'Questions for you'}
          </SectionHeader>
          {cur.checks.map((q, i) => {
            const a = answers[i];
            const thread = allExchanges.filter((e) => e.check === i);
            const choice = (value: CheckAnswer, label: string) => (
              <Button selected={a === value} aria-pressed={a === value} icon={a === value ? <Check size={14} aria-hidden /> : undefined} onClick={() => answer(i, value)}>
                {label}
              </Button>
            );
            return (
              <div key={i} className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-[1_1_360px] text-body break-words select-text">
                    <Markdown text={q} />
                  </div>
                  <span role="group" aria-label="Your answer" className="flex gap-1.5">
                    {choice('yes', 'Looks right')}
                    {choice('no', 'Needs a change')}
                    {choice('unsure', 'Not sure')}
                  </span>
                </div>
                {a === 'no' || a === 'unsure' ? (
                  <CheckFollowUp
                    key={`${cur.key}:${i}:${a}`}
                    data={askData}
                    step={cur}
                    index={i}
                    value={a}
                    note={answerNotes[i] ?? ''}
                    onNote={saveNote(cur.key, i, q)}
                    onChangeAsked={changeAsked(cur.key, i, q)}
                    exchanges={thread}
                    onShowChanges={showChanges}
                    loadedAt={loadedAt}
                    autoFocus={answered?.stepKey === cur.key && answered.index === i}
                    onCheckout={checkout}
                  />
                ) : (
                  thread.length > 0 && (
                    <div className="flex flex-col gap-3 border-t border-border pt-3">
                      <Thread data={data} exchanges={thread} onShowChanges={showChanges} loadedAt={loadedAt} />
                    </div>
                  )
                )}
              </div>
            );
          })}
        </section>
      )}

      {(asking || stepExchanges.length > 0) && (
        <AskPanel
          key={`ask:${cur.key}:${draft?.n ?? ''}`}
          data={askData}
          step={cur}
          exchanges={stepExchanges}
          onShowChanges={showChanges}
          loadedAt={loadedAt}
          draft={draft?.text}
          sendDraft={draft?.send}
          onCheckout={checkout}
        />
      )}

      <PushToPrNotice data={data} onPushed={showChanges} />

      {(commenting || ownComment) && <CommentBox key={`${cur.key}:${commentKey}`} initial={stepComment} onSave={(body) => patch({ type: 'comment', stepKey: cur.key, body })} />}
      {error && <Notice tone="error">{error}</Notice>}
    </main>,
    <>
      <Button size="lg" shortcut="review.previous" disabled={!dec && pos === 0} onClick={() => (dec ? prevDecision() : select(steps[pos - 1].key))}>
        Back
      </Button>
      <Button size="lg" shortcut="review.comment" onClick={openComment}>
        Comment
      </Button>
      {!asking && !stepExchanges.length && data.ask.question.by && (
        <Button size="lg" shortcut="review.ask" onClick={openAsk}>
          Ask or change
        </Button>
      )}
      {dec ? (
        decisionActions
      ) : (
        <Button variant={done ? 'secondary' : 'primary'} size="lg" shortcut="review.good" onClick={looksGood}>
          {done ? (pos < steps.length - 1 ? 'Reviewed, next' : 'Reviewed') : 'Looks good'}
        </Button>
      )}
    </>,
    contextAside(pos === 0)
  );
}

/** Unified or side by side (S), whether whitespace changes show (W), and whether long lines wrap (Z). */
function DiffToolbar({ mode, setMode, ignoreSpace, setIgnoreSpace, wrap, setWrap }: { mode: DiffMode; setMode(m: DiffMode): void; ignoreSpace: boolean; setIgnoreSpace(on: boolean): void; wrap: boolean; setWrap(on: boolean): void }) {
  return (
    <span className="flex items-center gap-3">
      <SegmentedControl<DiffMode>
        mode="radio"
        label="Diff layout"
        size="sm"
        value={mode}
        onChange={setMode}
        segments={[
          { value: 'unified', label: 'Unified', icon: <Rows2 size={13} aria-hidden />, tooltip: 'Unified (S)' },
          { value: 'split', label: 'Side by side', icon: <Columns2 size={13} aria-hidden />, tooltip: 'Side by side (S)' },
        ]}
      />
      <Checkbox checked={ignoreSpace} onChange={setIgnoreSpace} tooltip="Hide whitespace changes (W)">
        Hide whitespace
      </Checkbox>
      <Checkbox checked={wrap || mode === 'split'} onChange={setWrap} tooltip="Wrap long lines (Z)" disabledReason={mode === 'split' ? 'Side by side always wraps long lines' : null}>
        Wrap lines
      </Checkbox>
    </span>
  );
}
