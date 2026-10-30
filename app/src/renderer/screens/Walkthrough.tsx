// The step walkthrough: one step at a time, read top to bottom, with one clear next action.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { ArrowLeft, Check, Columns2, Rows2 } from 'lucide-react';
import { Crumbs, RiskPill, cleanError, isPlainKey, plural, reviewCrumbs, useMediaQuery, usePref } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { matches } from '../lib/shortcuts.ts';
import { DiffHunk, type DiffMode } from '../components/diff.tsx';
import { ChecksCard, StackBar } from '../components/github.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { OUTSIDE_HINT, isReviewed } from '../../shared/order.ts';
import { buildPlan, decisionLabels, isCareful, resumePoint, settleComment, type PlanDecision } from '../../shared/plan.ts';
import type { CheckAnswer, ReviewData, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';
import { answerLine } from '../../shared/comments.ts';
import { AskPanel, CheckFollowUp, Thread } from '../components/ask.tsx';
import { Markdown } from '../components/markdown.tsx';
import { useCodeSearch } from '../components/search.tsx';
import { EmptyStepNotice, WalkthroughBar } from '../components/walkthrough.tsx';
import { AgentTests, AskedFor, CommentBox, whyFallback } from './Review.tsx';
import { askedLabel } from './Plan.tsx';

export function Walkthrough({ go, data, initialState, stepKey, decision, group }: { go: Go; data: ReviewData; initialState: ReviewState; stepKey?: string; decision?: string; group?: string }) {
  const [state, setState] = useState(initialState);
  const latestState = useRef(state);
  latestState.current = state;
  // A review reads the branch once, so this is how old the diff on screen is. "Show the new diff" remounts it.
  const [loadedAt] = useState(() => new Date().toISOString());
  const plan = useMemo(() => buildPlan(data, state), [data, state.order]);
  const steps = plan.sequence;
  // Where you are comes from the route, so back and forward move between steps and decisions.
  // Opened without a place ("Continue review"): the first thing not done yet, decisions first.
  const [start] = useState(() => (stepKey || decision || group ? null : resumePoint(plan, state)));
  const startKey = start?.stepKey ?? steps[0]?.key;
  const decisionId = decision ?? (stepKey ? undefined : start?.decision?.id);
  const dec = decisionId ? (plan.decisions.find((d) => d.id === decisionId) ?? null) : null;
  const decPos = dec ? plan.decisions.indexOf(dec) : -1;
  const selKey = dec ? (stepKey && dec.stepKeys.includes(stepKey) ? stepKey : dec.stepKeys[0]) : (stepKey ?? startKey);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // The question you just answered "Needs a change" or "Not sure", so its box takes the focus.
  const [answered, setAnswered] = useState<{ stepKey: string; index: number } | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [commentKey, setCommentKey] = useState(0);
  const [showContext, setShowContext] = usePref<boolean>('walkthrough-context', true);
  const [mode, setMode] = usePref<DiffMode>('diff-mode', 'unified');
  const [ignoreSpace, setIgnoreSpace] = usePref<boolean>('diff-ignore-space', false);
  // Context steps aside when the diff needs the room: side by side, or a narrow window. You can still open it.
  const wide = useMediaQuery('(min-width: 1400px)');
  const autoHide = mode === 'split' || !wide;
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

  const at = (to: { stepKey?: string; decision?: string; group?: string }) => go({ name: 'review', projectId: data.projectId, branch: data.branch, ...to });
  const select = (key: string) => at({ stepKey: key });
  const decide = (d: PlanDecision) => at({ decision: d.id, stepKey: d.stepKeys[0] });
  const toPlan = () => go({ name: 'plan', projectId: data.projectId, branch: data.branch });
  const search = useCodeSearch(data, (key) => select(key));

  // A new place starts with the comment and question boxes closed.
  useEffect(() => {
    setAsking(false);
    setCommenting(false);
  }, [selKey, decision]);

  /** After the decisions: the first step you haven't reviewed, or wrap up. */
  const pastDecisions = (s: ReviewState = state) => {
    const open = steps.find((x) => !isReviewed(x, s.reviewed));
    if (open) select(open.key);
    else go({ name: 'finish', projectId: data.projectId, branch: data.branch });
  };
  const nextDecision = () => (plan.decisions[decPos + 1] ? decide(plan.decisions[decPos + 1]) : pastDecisions());
  const prevDecision = () => (decPos > 0 ? decide(plan.decisions[decPos - 1]) : toPlan());
  const keys = useRef({ looksGood: () => {}, groupDone: () => {} });

  // The review's keys, from the registry: j and k move, r says it looks good (or gives a decision its main
  // answer), n needs a fix, c comments, a asks Claude, s and w change the diff, Esc goes back to the plan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e)) return;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (matches(e, 'review.plan')) return run(toPlan);
      if (matches(e, 'review.finish')) return run(() => go({ name: 'finish', projectId: data.projectId, branch: data.branch }));
      if (matches(e, 'review.layout')) return run(() => setMode(mode === 'split' ? 'unified' : 'split'));
      if (matches(e, 'review.whitespace')) return run(() => setIgnoreSpace(!ignoreSpace));
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
      if (matches(e, 'review.ask') && cur) return run(openAsk);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openComment = () => {
    setCommenting(true);
    setTimeout(() => document.getElementById('feedback')?.focus(), 0);
  };
  const openAsk = () => {
    setAsking(true);
    setTimeout(() => (document.querySelector('[aria-label="Your question or change"]') as HTMLElement | null)?.focus(), 0);
  };

  const careful = !!cur && isCareful(cur);

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

  const segs = (list: Step[]) => list.map((s) => ({ key: s.key, title: `Step ${s.index + 1}: ${s.title}`, done: isReviewed(s, state.reviewed), current: !dec && s.key === cur?.key, onClick: () => select(s.key) }));
  const firstOf = (list: Step[]) => list.find((s) => !isReviewed(s, state.reviewed)) ?? list[0];
  const phases = [
    {
      label: 'Decide',
      now: !!dec,
      onClick: () => decide(plan.decisions.find((d) => !state.settled?.[d.id]) ?? plan.decisions[0]),
      segments: plan.decisions.map((d) => ({ key: d.id, title: d.title, done: !!state.settled?.[d.id], current: d.id === dec?.id, onClick: () => decide(d) })),
    },
    { label: 'Read closely', now: !dec && careful, onClick: () => select(firstOf(plan.careful).key), segments: segs(plan.careful) },
    { label: 'Skim', now: !dec && !!cur && !careful, onClick: () => select(firstOf(plan.skim).key), segments: segs(plan.skim) },
  ].filter((p) => p.segments.length > 0);

  const phaseList = careful ? plan.careful : plan.skim;
  const here = skimGroup
    ? `Skim · ${skimGroup.name}`
    : dec
    ? `Decision ${decPos + 1} of ${plan.decisions.length}`
    : cur
      ? `${careful ? 'Read closely' : 'Skim'} · step ${phaseList.findIndex((s) => s.key === cur.key) + 1} of ${phaseList.length}`
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
                <button key={x.key} type="button" data-tooltip={x.title} aria-label={x.title} aria-current={x.current ? 'step' : undefined} onClick={x.onClick} className="min-w-0 flex-1 py-1">
                  <span className={`block h-1 rounded-full ${x.done ? 'bg-text' : x.current ? 'bg-text/45 outline-2 outline-offset-1 outline-text' : 'bg-selected'}`} />
                </button>
              ))
            ) : (
              <button type="button" onClick={p.onClick} aria-label={`${p.label}: ${done} of ${n} done`} className="flex-1 py-1">
                <span className="block h-1 rounded-full" style={{ background: `linear-gradient(to right, var(--sb-text) ${(done / n) * 100}%, var(--sb-selected) 0)` }} />
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
      {search.button}
      <Button variant="quiet" icon={<ArrowLeft size={13} aria-hidden />} shortcut="review.plan" onClick={toPlan}>
        Plan
      </Button>
      {cur && !skimGroup && (
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
      <span className="ml-2 flex items-center gap-1.5 text-meta text-faint">
        <Kbd shortcut="shortcuts" /> every shortcut
      </span>
    </footer>
  );

  const shell = (body: React.ReactNode, foot: React.ReactNode, aside?: React.ReactNode) => (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {header}
      <WalkthroughBar data={data} onSwitch={() => go({ name: 'review', projectId: data.projectId, branch: data.branch, reload: Date.now() })} />
      {search.panel}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{body}</div>
        {aside}
      </div>
      {footer(foot)}
    </div>
  );

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
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-7">
        <div className="flex flex-col gap-1.5">
          <span className="text-meta text-faint">
            Skim · {plural(groupSteps.length, 'low-risk step')} · {plural(skimGroup.files, 'file')}
            {left.length < groupSteps.length ? ` · ${groupSteps.length - left.length} already reviewed` : ''}
          </span>
          <h1 className="font-mono text-hero font-semibold break-all">{skimGroup.name}</h1>
          <p className="text-body text-muted">Everything low risk in this folder, on one page. Scroll through, comment on a line where something looks off, then mark the whole folder reviewed.</p>
        </div>
        <DiffToolbar mode={mode} setMode={setMode} ignoreSpace={ignoreSpace} setIgnoreSpace={setIgnoreSpace} />
        {groupSteps.map((x) => (
          <section key={x.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-title font-semibold break-words">
                Step {x.index + 1}: {x.title}
              </h2>
              <RiskPill risk={x.risk} />
              {isReviewed(x, state.reviewed) && <Pill tone="muted">Reviewed</Pill>}
            </div>
            {x.why && <p className="text-body text-text select-text">{x.why}</p>}
            {x.hunkIds.map((id) => {
              const h = data.hunks[id];
              return h ? (
                <DiffHunk
                  key={id}
                  hunk={h}
                  mode={mode}
                  ignoreSpace={ignoreSpace}
                  comments={state.comments.filter((c) => c.hunkId === id && c.line)}
                  onComment={(a, body, cid) => patch({ type: 'line-comment', id: cid, stepKey: x.key, hunkId: id, path: h.path, line: a.line, side: a.side, body })}
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
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-7">
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
  const showChanges = () => go({ name: 'review', projectId: data.projectId, branch: data.branch, stepKey: cur.key, reload: Date.now() });


  const changedSince = since?.byStep[cur.key];
  const aside = contextShown && (
    <aside aria-label="Context" className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-sidebar px-4 py-5">
      <section className="flex flex-col gap-1.5">
        <SectionHeader as="h3">{askedLabel(data)}</SectionHeader>
        <AskedFor data={data} clamp={pos === 0 ? 400 : 160} />
        {data.session && (
          <button type="button" className="self-start text-ui text-link hover:underline" onClick={() => window.api.openSessionFile(data.session!.file)}>
            Open the agent session
          </button>
        )}
      </section>
      {data.agentTests && (
        <section className="flex flex-col gap-1.5 text-ui">
          <SectionHeader as="h3">The agent’s tests</SectionHeader>
          <AgentTests data={data} />
        </section>
      )}
      {data.stack && <StackBar data={data} go={go} />}
      <ChecksCard data={data} />
    </aside>
  );

  return shell(
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-7">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <RiskPill risk={cur.risk} />
          {cur.outsideTask && <Pill data-tooltip={OUTSIDE_HINT}>Outside your request</Pill>}
          {done && <Pill tone="muted">Reviewed</Pill>}
          {changedSince && changedSince !== 'same' && <Pill tone="link">{changedSince === 'new' ? 'New' : 'Changed'} since your last review</Pill>}
        </div>
        <h1 className="text-hero font-semibold break-words">{cur.title}</h1>
        <p className={`text-body select-text ${cur.why ? 'text-text' : 'text-muted'}`}>{cur.why || whyFallback(cur, data)}</p>
      </div>

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
        <EmptyStepNotice data={data} onReload={() => go({ name: 'review', projectId: data.projectId, branch: data.branch, stepKey: cur.key, reload: Date.now() })} onOpenStep={select} />
      )}

      {cur.hunkIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-faint">
              {plural(cur.files.length, 'file')} · {plural(cur.hunkIds.length, 'change')}
            </span>
            {/* With more than one file, a chip per file jumps to its first change. */}
            {cur.files.length > 1 &&
              cur.files.map((f) => {
                const first = cur.hunkIds.find((id) => data.hunks[id]?.path === f);
                return first ? (
                  <Pill key={f} tone="muted" className="font-mono" data-tooltip={f} onClick={() => document.getElementById(`hunk-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {f.split('/').pop()}
                  </Pill>
                ) : null;
              })}
          </span>
          <DiffToolbar mode={mode} setMode={setMode} ignoreSpace={ignoreSpace} setIgnoreSpace={setIgnoreSpace} />
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
              comments={state.comments.filter((c) => c.hunkId === id && c.line)}
              onComment={lineComment(id, h.path)}
              loadLines={(side, from, to) => window.api.fileLines(data.projectId, data.branch, side === 'old' ? (h.oldPath ?? h.path) : h.path, side, from, to)}
              collapsed={since?.reviewedBefore.has(id) ? 'You reviewed this exact change last time.' : null}
              badge={isNew ? <Pill tone="link">New since your last review</Pill> : null}
              noteBy={data.walkthrough === 'reviewer' ? 'reviewer' : 'agent'}
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
                    data={data}
                    step={cur}
                    index={i}
                    value={a}
                    note={answerNotes[i] ?? ''}
                    onNote={saveNote(cur.key, i, q)}
                    exchanges={thread}
                    onShowChanges={showChanges}
                    loadedAt={loadedAt}
                    autoFocus={answered?.stepKey === cur.key && answered.index === i}
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
          key={`ask:${cur.key}`}
          data={data}
          step={cur}
          exchanges={stepExchanges}
          onShowChanges={showChanges}
          loadedAt={loadedAt}
        />
      )}

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
      {!asking && !stepExchanges.length && (
        <Button size="lg" shortcut="review.ask" onClick={openAsk}>
          Ask Claude
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
    aside
  );
}

/** Unified or side by side (S), and whether whitespace changes show (W). */
function DiffToolbar({ mode, setMode, ignoreSpace, setIgnoreSpace }: { mode: DiffMode; setMode(m: DiffMode): void; ignoreSpace: boolean; setIgnoreSpace(on: boolean): void }) {
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
    </span>
  );
}
