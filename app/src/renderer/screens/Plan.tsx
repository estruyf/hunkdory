// The review plan: decide, look carefully, skim. Sorts a big change so you know where to start.
import { useEffect, useMemo, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Crumbs, LoadingPage, RiskPill, cleanError, plural, reviewCrumbs, sizeText, useAsync } from '../components/ui.tsx';
import { StackBar } from '../components/github.tsx';
import { ReviewError } from './Review.tsx';
import { isReviewed } from '../../shared/order.ts';
import { buildPlan, decisionLabels, planProgress, resumePoint, settleComment, type PlanDecision } from '../../shared/plan.ts';
import type { ReviewData, ReviewState, Step } from '../../shared/types.ts';

export function PlanScreen({ go, projectId, branch, preloaded }: { go: Go; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } }) {
  if (preloaded) return <PlanView go={go} data={preloaded.data} initialState={preloaded.state} />;
  return <LoadPlan go={go} projectId={projectId} branch={branch} />;
}

function LoadPlan({ go, projectId, branch }: { go: Go; projectId: string; branch: string }) {
  const loaded = useAsync(() => window.api.loadReview(projectId, branch), [projectId, branch]);
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!loaded.value) return <LoadingPage onHome={() => go({ name: 'home' })} label="Reading the branch…" detail={branch} />;
  return <PlanView go={go} data={loaded.value.data} initialState={loaded.value.state} />;
}

const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const count = (n: number) => words[n] ?? String(n);

function headline(decisions: number, careful: number, skim: number) {
  if (decisions && careful) return `${count(decisions)} ${decisions === 1 ? 'decision' : 'decisions'}, then ${careful === 1 ? 'one step' : `${careful} steps`} to read closely`;
  if (decisions) return `${count(decisions)} ${decisions === 1 ? 'decision' : 'decisions'}, then a quick skim`;
  if (careful) return `${careful === 1 ? 'One step' : `${careful} steps`} to read closely${skim ? ', then a quick skim' : ''}`;
  return 'Low risk all round: a quick skim';
}

function PlanView({ go, data, initialState }: { go: Go; data: ReviewData; initialState: ReviewState }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [allCareful, setAllCareful] = useState(false);
  const plan = useMemo(() => buildPlan(data, state), [data, state.order]);
  const progress = planProgress(plan, state);

  useEffect(
    () =>
      window.events.onReviewStateChanged((r) => {
        if (r.projectId === data.projectId && r.branch === data.branch) setState(r);
      }),
    [data.projectId, data.branch]
  );

  const open = (step: Step | undefined) => step && go({ name: 'review', projectId: data.projectId, branch: data.branch, stepKey: step.key, preloaded: { data, state } });
  const firstOpen = (steps: Step[]) => steps.find((s) => !isReviewed(s, state.reviewed)) ?? steps[0];
  const next = plan.sequence.find((s) => !isReviewed(s, state.reviewed));
  const started = Object.keys(state.reviewed).length > 0 || progress.decided > 0;
  const allDone = !next && progress.decided === progress.decisions;
  // Continue where nothing is done yet, decisions first, so nothing you put off gets skipped.
  const resume = resumePoint(plan, state);
  const goResume = () =>
    resume && go({ name: 'review', projectId: data.projectId, branch: data.branch, decision: resume.decision?.id, stepKey: resume.stepKey, preloaded: { data, state } });

  const settle = async (d: PlanDecision, value: 'fine' | 'fix' | null) => {
    try {
      setState(await window.api.updateReview(data.projectId, data.branch, { type: 'settle', id: d.id, value, comment: settleComment(d, value, d.stepKeys[0]) }));
      setError(null);
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const carefulShown = allCareful ? plan.careful : plan.careful.slice(0, 8);

  return (
    <div className="page">
      <header className="topbar" style={{ gap: '12px 20px', padding: '12px 24px' }}>
        <Brand onClick={() => go({ name: 'home' })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 320px', minWidth: 0 }}>
          <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, shrink: true }]} />
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            <span className="mono">{data.branch}</span> → <span className="mono">{data.baseRef}</span>
            {data.pr ? ` · PR #${data.pr.number}` : ''}
            {data.stack ? ` · part ${data.stack.prs.findIndex((p) => p.current) + 1} of ${data.stack.prs.length} in a stack` : ''} · {sizeText(data.files, data.added, data.removed)}
          </span>
        </div>
        {resume && (
          <button type="button" className="btn" onClick={goResume}>
            {started ? 'Continue' : resume.decision ? 'Start with the decisions' : 'Start at step 1'}
          </button>
        )}
        <button type="button" className={`btn ${allDone ? 'primary' : ''}`} style={allDone ? undefined : { borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => go({ name: 'finish', projectId: data.projectId, branch: data.branch })}>
          Finish
        </button>
      </header>

      <div style={{ width: '100%', maxWidth: 1240, margin: '0 auto', padding: '28px 24px 56px', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ fontSize: 26, letterSpacing: '-0.015em' }}>{allDone ? 'All done. Time to wrap up.' : headline(plan.decisions.length, plan.careful.length, plan.skim.length)}</h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 760 }}>
            {allDone
              ? 'You made every decision and looked at every step. Finish to merge, send it back, or post your review.'
              : `Reviewer sorted the ${plural(data.steps.length, 'step')} for you. Start with what only you can decide. ${plan.skim.length ? 'The low-risk rest is grouped so you can skim it.' : ''}`}
          </p>
          {data.stack && (
            <div style={{ paddingTop: 6 }}>
              <StackBar data={data} go={go} />
            </div>
          )}
          {data.walkthrough === 'skeleton' && (
            <p className="notice info">This branch has no walkthrough, so each step is one file and there is less to go on.</p>
          )}
        </div>

        <Phase n={1} title="Decide" meta={plan.decisions.length ? `${progress.decided} of ${progress.decisions} done` : 'Nothing to decide'}>
          {plan.decisions.length === 0 ? (
            <p style={{ fontSize: 14.5, color: 'var(--muted)' }}>No changes outside your request, no failing checks, and nothing flagged.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {plan.decisions.map((d) => (
                <DecisionCard key={d.id} d={d} steps={data.steps} value={state.settled?.[d.id]} onSettle={(v) => settle(d, v)} onShow={(key) => go({ name: 'review', projectId: data.projectId, branch: data.branch, decision: d.id, stepKey: key, preloaded: { data, state } })} onCi={() => {
                  const failing = data.pr?.checks.find((c) => c.state === 'fail' && c.url);
                  window.api.openExternal(failing?.url ?? data.pr!.url);
                }} />
              ))}
            </div>
          )}
        </Phase>

        {plan.careful.length > 0 && (
          <Phase n={2} title="Look carefully" meta={`${progress.carefulDone} of ${plural(plan.careful.length, 'step')} reviewed · about ${Math.max(1, Math.round((data.minutes * plan.careful.length) / Math.max(1, data.steps.length)))} min`}>
            <div className="card" style={{ overflow: 'hidden' }}>
              {carefulShown.map((s) => {
                const done = isReviewed(s, state.reviewed);
                return (
                  <button key={s.key} type="button" onClick={() => open(s)} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', width: '100%', padding: '14px 18px', border: 0, borderBottom: '1px solid var(--divider)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)' }}>
                    <span aria-hidden="true" style={{ flex: 'none', width: 12, height: 12, borderRadius: 999, ...(done ? { background: 'var(--accent)' } : { border: `2px solid ${s.risk === 'high' ? 'var(--high-fg)' : 'var(--med-fg)'}` }) }} />
                    <span style={{ flex: '1 1 360px', fontSize: 15, fontWeight: 500, overflowWrap: 'anywhere', color: done ? 'var(--muted)' : 'var(--text)' }}>{s.title}</span>
                    <RiskPill risk={s.risk} />
                    {s.outsideTask && <span className="pill medium">Outside the task</span>}
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
          <Phase n={plan.careful.length ? 3 : 2} title="Skim" meta={`${progress.skimDone} of ${plural(plan.skim.length, 'low-risk step')} reviewed`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
              {plan.skimGroups.map((g) => {
                const done = g.steps.filter((s) => isReviewed(s, state.reviewed)).length;
                return (
                  <div key={g.name} className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{g.name}</span>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {plural(g.steps.length, 'step')} · {plural(g.files, 'file')}
                    </span>
                    <button type="button" className={`btn ${done === g.steps.length ? 'done' : ''}`} style={{ alignSelf: 'flex-start', marginTop: 4, height: 34, padding: '0 12px', fontSize: 13 }} onClick={() => open(firstOpen(g.steps))}>
                      {done === g.steps.length ? 'Skimmed ✓' : done ? `Continue · ${done} of ${g.steps.length}` : 'Skim'}
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

function Phase({ n, title, meta, children }: { n: number; title: string; meta: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--text)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {n}
        </span>
        <h2 style={{ fontSize: 17 }}>{title}</h2>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{meta}</span>
      </div>
      {children}
    </section>
  );
}

const TAG: Record<PlanDecision['kind'], string> = { outside: 'Outside your request', ci: 'CI', flag: 'Flagged' };

function DecisionCard({ d, steps, value, onSettle, onShow, onCi }: { d: PlanDecision; steps: Step[]; value?: 'fine' | 'fix'; onSettle: (v: 'fine' | 'fix' | null) => void; onShow: (stepKey: string) => void; onCi: () => void }) {
  const [details, setDetails] = useState(false);
  const labels = decisionLabels(d);
  const stepOf = (key: string) => steps.find((s) => s.key === key);
  // You can only judge what you've seen: with steps to look at, the decision is made there, next to the code.
  const first = d.stepKeys.map(stepOf).find(Boolean);
  const single = d.stepKeys.length === 1 && first;
  return (
    <article className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, opacity: value ? 0.75 : 1 }}>
      <span className={`pill ${d.severity === 'high' ? 'high' : 'medium'}`} style={{ alignSelf: 'flex-start' }}>
        {d.kind === 'flag' && d.severity === 'high' ? 'Look into this' : TAG[d.kind]}
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
          <button type="button" className="btn primary" style={{ height: 36, fontSize: 13.5 }} onClick={() => onShow(first.key)}>
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
          <button type="button" className="btn primary" style={{ height: 36, fontSize: 13.5 }} onClick={() => onSettle('fine')}>
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
