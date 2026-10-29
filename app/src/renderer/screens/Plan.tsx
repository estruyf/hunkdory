// The review plan, and the way into a review: decide, read closely, skim.
// Opening a branch lands here. One button starts (or continues) the review where it makes sense.
import { useEffect, useMemo, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Crumbs, LoadingPage, RiskPill, cleanError, isPlainKey, plural, reviewCrumbs, sizeText, useAsync, usePref, useShortcutSheet } from '../components/ui.tsx';
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
    if (allDone) return 'Finish the review →';
    if (!resume) return 'Start review →';
    const verb = needsStart ? 'Start' : 'Continue';
    if (writing && needsStart) return 'Start with one step per file';
    if (resume.decision) return `${verb}: decision ${plan.decisions.indexOf(resume.decision) + 1} of ${plan.decisions.length} →`;
    return `${verb}: step ${plan.sequence.findIndex((s) => s.key === resume.stepKey) + 1} of ${plan.sequence.length} →`;
  })();

  const sheet = useShortcutSheet([
    ['↵', ctaLabel.replace(' →', '')],
    ['/', 'Search the code'],
    ['f', 'Finish'],
    ['?', 'This list'],
  ]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e) || sheet.open || (e.target as HTMLElement).closest('button, a')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        go1();
      } else if (e.key === 'f') {
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
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go({ name: 'home' })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 320px', minWidth: 0 }}>
          <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, shrink: true }]} />
          <span className="topbar-sub">
            <span className="mono">{data.branch}</span> → <span className="mono">{data.baseRef}</span>
            {data.pr ? ` · PR #${data.pr.number}` : ''}
            {data.stack ? ` · part ${data.stack.prs.findIndex((p) => p.current) + 1} of ${data.stack.prs.length} in a stack` : ''} · {sizeText(data.files, data.added, data.removed)}
          </span>
        </div>
        {search.button}
        <button type="button" className={`btn ${allDone ? 'primary' : 'quiet'}`} style={{ height: 36 }} onClick={toFinish}>
          Finish
        </button>
      </header>
      {search.panel}
      {sheet.sheet}

      <div style={{ width: '100%', maxWidth: 1240, margin: '0 auto', padding: '28px 24px 56px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
              <span>About {formatDuration(data.minutes)}</span>
              <span>{plural(data.steps.length, 'step')}</span>
              <span>
                {data.session
                  ? `Claude Code session, last active ${timeAgo(data.session.endedAt)}`
                  : data.agent === 'copilot' && data.pr
                    ? `GitHub Copilot, updated ${timeAgo(data.pr.updatedAt)}`
                    : data.pr
                      ? `PR by ${data.pr.author}, updated ${timeAgo(data.pr.updatedAt)}`
                      : data.author
                        ? `Last commit by ${data.author}`
                        : 'No agent session found'}
              </span>
              {data.pr && data.pr.checks.length > 0 && (
                <span className={`pill ${checksTone(data.pr.checks)}`} style={{ border: 0 }}>
                  CI: {checksText(data.pr.checks)}
                </span>
              )}
              {data.pr && (
                <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => window.api.openExternal(data.pr!.url)}>
                  Open on GitHub ↗
                </button>
              )}
            </span>
            <h1 style={{ fontSize: 28, lineHeight: 1.2, letterSpacing: '-0.015em' }}>{allDone ? 'All done. Time to wrap up.' : headline(plan.decisions.length, plan.careful.length, plan.skim.length)}</h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 720 }}>
              {allDone
                ? 'You made every decision and looked at every step. Finish to merge, send it back, or post your review.'
                : `Hunkdory sorted the ${plural(data.steps.length, 'step')} for you. Start with what only you can decide.${plan.skim.length ? ' The low-risk rest is grouped so you can skim it.' : ''}`}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <button type="button" className="btn primary" style={{ height: 48, padding: '0 24px', fontSize: 15, borderRadius: 10 }} onClick={go1}>
              {ctaLabel}
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 12 }}>
              <span>
                <span className="kbd">↵</span> to {needsStart ? 'start' : 'go'}
              </span>
              {sheet.button}
            </span>
          </div>
        </div>

        {since && counts && (
          <section className="notice info" aria-label="Since your last review" style={{ flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
            <span style={{ flex: '1 1 420px' }}>
              <strong>Since your last review:</strong>{' '}
              {[counts.changed && `${plural(counts.changed, 'step')} changed`, counts.new && `${plural(counts.new, 'step')} new`, counts.same && `${counts.same} the same`].filter(Boolean).join(', ') || 'nothing changed'}
              {since.gone ? `. ${plural(since.gone, 'earlier change')} ${since.gone === 1 ? 'is' : 'are'} gone.` : '.'}{' '}
              <span className="muted">
                You {since.decision.kind === 'send-back' ? 'sent it back' : since.decision.kind === 'github' ? 'reviewed it on GitHub' : 'finished it'} {timeAgo(since.decision.at)}.
              </span>
            </span>
            {since.alreadyReviewed.length > 0 && (
              <label className="choice" style={{ alignItems: 'center' }}>
                <input type="checkbox" checked={skipSeen} onChange={(e) => setSkipSeen(e.target.checked)} style={{ marginTop: 0 }} />
                Mark the {plural(since.alreadyReviewed.length, 'unchanged step')} as reviewed
              </label>
            )}
          </section>
        )}

        {data.stack && <StackBar data={data} go={go} />}
        <WalkthroughNotice data={data} w={w} />

        {tooBig({ minutes: data.minutes, steps: data.steps.length }) && (
          <div className="notice" role="note" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ flex: '1 1 480px' }}>
              <strong>Too big for one sitting.</strong> About {formatDuration(data.minutes)} of reading. Smaller branches get a better review: ask the agent to split it. Or take it over several sittings: Hunkdory keeps your place.
            </span>
            <button
              type="button"
              className="link"
              style={{ fontSize: 13.5, fontWeight: 600 }}
              onClick={async () => {
                await navigator.clipboard.writeText(splitRequest(data.branch, data.steps.length, formatDuration(data.minutes)));
                setCopied(true);
              }}
            >
              {copied ? 'Copied. Paste it into the agent’s session.' : 'Copy a request to split it'}
            </button>
          </div>
        )}

        <HowItWorks />
        <RequestCard data={data} onOpen={open} />

        <Phase n={1} title="Decide" hint="Calls only you can make: work you didn’t ask for, failing CI, and patterns that need attention." meta={plan.decisions.length ? `${progress.decided} of ${progress.decisions} done` : 'Nothing to decide'}>
          {plan.decisions.length === 0 ? (
            <p style={{ fontSize: 14.5, color: 'var(--muted)' }}>No changes outside your request, no failing checks, and nothing flagged.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
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
            n={2}
            title="Read closely"
            hint="Steps that need attention, or that you didn’t ask for. Read the code."
            meta={`${progress.carefulDone} of ${plural(plan.careful.length, 'step')} reviewed · about ${minutesFor(plan.careful.length)} min`}
            aside={
              <label style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
                Order
                <select className="field" value={state.order} onChange={(e) => patch({ type: 'order', order: e.target.value as ReviewOrder })} style={{ height: 32, fontSize: 13, padding: '0 8px' }}>
                  {ORDERS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            }
          >
            <div className="card" style={{ overflow: 'hidden' }}>
              {carefulShown.map((s) => {
                const done = isReviewed(s, state.reviewed);
                const changed = since?.byStep[s.key];
                return (
                  <button key={s.key} type="button" onClick={() => open(s)} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', width: '100%', padding: '14px 18px', border: 0, borderBottom: '1px solid var(--divider)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)' }}>
                    <span aria-hidden="true" style={{ flex: 'none', width: 12, height: 12, borderRadius: 999, ...(done ? { background: 'var(--accent)' } : { border: `2px solid ${s.risk === 'high' ? 'var(--high-fg)' : 'var(--med-fg)'}` }) }} />
                    <span style={{ flex: '1 1 360px', fontSize: 15, fontWeight: 500, overflowWrap: 'anywhere', color: done ? 'var(--muted)' : 'var(--text)' }}>{s.title}</span>
                    {changed && changed !== 'same' && <span className="pill accent">{changed === 'new' ? 'New' : 'Changed'}</span>}
                    <RiskPill risk={s.risk} />
                    {s.outsideTask && (
                      <span className="pill medium" title={OUTSIDE_HINT}>
                        Outside your request
                      </span>
                    )}
                    <span style={{ fontSize: 13, color: 'var(--muted)', width: 64, textAlign: 'right' }}>{plural(s.files.length, 'file')}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: done ? 'var(--low-fg)' : 'var(--accent)', width: 90, textAlign: 'right' }}>{done ? 'Reviewed ✓' : 'Review →'}</span>
                  </button>
                );
              })}
              {plan.careful.length > carefulShown.length && (
                <button type="button" className="link" style={{ padding: '12px 18px', fontSize: 13.5, fontWeight: 500 }} onClick={() => setAllCareful(true)}>
                  Show {plan.careful.length - carefulShown.length} more
                </button>
              )}
            </div>
          </Phase>
        )}

        {plan.skim.length > 0 && (
          <Phase n={plan.careful.length ? 3 : 2} title="Skim" hint="Low-risk steps, grouped by folder. Open a folder to see all of it on one page, then mark it reviewed in one go." meta={`${progress.skimDone} of ${plural(plan.skim.length, 'low-risk step')} reviewed · about ${minutesFor(plan.skim.length)} min`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
              {plan.skimGroups.map((g) => {
                const done = g.steps.filter((s) => isReviewed(s, state.reviewed)).length;
                return (
                  <div key={g.name} className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {g.name}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {plural(g.steps.length, 'step')} · {plural(g.files, 'file')}
                    </span>
                    <button type="button" className={`btn ${done === g.steps.length ? 'done' : ''}`} style={{ alignSelf: 'flex-start', marginTop: 4, height: 34, padding: '0 12px', fontSize: 13 }} onClick={() => enter({ group: g.name })}>
                      {done === g.steps.length ? 'Reviewed ✓' : done ? `Skim folder · ${done} of ${g.steps.length}` : 'Skim folder'}
                    </button>
                  </div>
                );
              })}
            </div>
          </Phase>
        )}
        {error && <p className="error">{error}</p>}
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

/** A first-run explainer of the review flow. Dismissed once, for good. */
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
    <section className="notice info" aria-label="How a review works" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <strong>How a review works</strong>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(([t, d]) => (
          <li key={t}>
            <strong>{t}.</strong> {d}
          </li>
        ))}
      </ol>
      <span>
        <button type="button" className="link" style={{ fontSize: 13.5, fontWeight: 600 }} onClick={() => setShow(false)}>
          Got it
        </button>
      </span>
    </section>
  );
}

/** What you asked, what the change does, and what it does that you didn't ask for: the yardstick for the review. */
function RequestCard({ data, onOpen }: { data: ReviewData; onOpen: (step: Step) => void }) {
  const outside = data.steps.filter((s) => s.outsideTask);
  const hasRequest = !!(data.prompt || data.pr?.body.trim());
  const row = (label: string, body: React.ReactNode) => (
    <>
      <h2 className="label-sm" style={{ paddingTop: 2 }}>
        {label}
      </h2>
      <div style={{ minWidth: 0, fontSize: 14.5, lineHeight: 1.55 }}>{body}</div>
    </>
  );
  return (
    <section className="card" aria-label="The change" style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'minmax(110px, max-content) 1fr', gap: '14px 20px' }}>
      {row(askedLabel(data), <AskedFor data={data} clamp={240} />)}
      {row('It did', data.intent ?? <span className="muted">{data.walkthrough === 'skeleton' ? 'No walkthrough yet, so there is no summary: the steps are one per file.' : 'The walkthrough has no summary.'}</span>)}
      {row(
        'It also did',
        outside.length ? (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            {outside.map((s) => (
              <button key={s.key} type="button" className="link" style={{ fontSize: 14.5, textAlign: 'left', overflowWrap: 'anywhere' }} onClick={() => onOpen(s)}>
                Step {s.index + 1}: {s.title} ({plural(s.files.length, 'file')}) →
              </button>
            ))}
          </span>
        ) : (
          <span className="muted">{hasRequest ? (data.walkthrough === 'skeleton' ? 'Unknown until there is a walkthrough.' : 'Nothing outside your request.') : 'There is no request to compare with, so nothing is marked as outside it.'}</span>
        )
      )}
      {data.agentTests && row('Its tests', <AgentTests data={data} />)}
    </section>
  );
}

/** "You asked" for a prompt, "The PR says" for a PR description: the same words on every screen. */
export const askedLabel = (data: Pick<ReviewData, 'prompt' | 'pr'>) => (data.prompt || !data.pr ? 'You asked' : 'The PR says');

function Phase({ n, title, hint, meta, aside, children }: { n: number; title: string; hint: string; meta: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px 10px', flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--text)', color: 'var(--surface)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {n}
        </span>
        <h2 style={{ fontSize: 17 }}>{title}</h2>
        <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{meta}</span>
        {aside}
        <p style={{ flexBasis: '100%', paddingLeft: 36, fontSize: 13.5, color: 'var(--muted)' }}>{hint}</p>
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
    <article className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, opacity: value ? 0.75 : 1 }}>
      <span className={`pill ${d.severity === 'high' ? 'high' : 'medium'}`} style={{ alignSelf: 'flex-start' }} title={d.kind === 'outside' ? OUTSIDE_HINT : undefined}>
        {tag(d)}
      </span>
      <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{d.title}</h3>
      <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{d.detail}</p>
      {/* Without a walkthrough the step is named after its file, which the detail already says. */}
      {single && !d.detail.includes(single.title) && (
        <span style={{ fontSize: 13.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
          Step {single.index + 1}: {single.title}
        </span>
      )}
      {(d.stepKeys.length > 1 || d.places.length > 1 || d.files.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!single && d.stepKeys.slice(0, details ? undefined : 2).map((k) => {
            const s = stepOf(k);
            return s ? (
              <button key={k} type="button" className="link" style={{ fontSize: 13.5, textAlign: 'left', overflowWrap: 'anywhere' }} onClick={() => onShow(k)}>
                Step {s.index + 1}: {s.title} →
              </button>
            ) : null;
          })}
          {details && d.files.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {d.files.map((f) => (
                <li key={f} className="mono" style={{ overflowWrap: 'anywhere' }}>{f}</li>
              ))}
            </ul>
          )}
          {details && d.kind === 'flag' && d.places.length > 1 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {d.places.map((p, i) => (
                <li key={i} style={{ overflowWrap: 'anywhere' }}>{p}</li>
              ))}
            </ul>
          )}
          {(d.stepKeys.length > 2 || d.files.length > 0 || (d.kind === 'flag' && d.places.length > 1)) && (
            <button type="button" className="link" style={{ fontSize: 13, fontWeight: 500, textAlign: 'left' }} onClick={() => setDetails(!details)}>
              {details ? 'Show less' : d.files.length ? `Show the ${plural(d.files.length, 'file')}` : 'Show every place'}
            </button>
          )}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {value ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
          <span style={{ fontWeight: 600, color: value === 'fine' ? 'var(--low-fg)' : 'var(--med-fg)' }}>✓ {value === 'fine' ? labels.fineDone : labels.fixDone}</span>
          <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => onSettle(null)}>
            Change
          </button>
          {first && (
            <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => onShow(first.key)}>
              Look again
            </button>
          )}
        </div>
      ) : first ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn" style={{ height: 36, fontSize: 13.5 }} onClick={() => onShow(first.key)}>
            {single ? 'Look at the change →' : `Start at step ${first.index + 1} →`}
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>You decide there, next to the code.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {d.kind === 'ci' && (
            <button type="button" className="btn" style={{ height: 36, fontSize: 13.5 }} onClick={onCi}>
              Open checks ↗
            </button>
          )}
          <button type="button" className="btn" style={{ height: 36, fontSize: 13.5 }} onClick={() => onSettle('fine')}>
            {labels.fine}
          </button>
          <button type="button" className="btn" style={{ height: 36, fontSize: 13.5 }} onClick={() => onSettle('fix')}>
            {labels.fix}
          </button>
        </div>
      )}
    </article>
  );
}
