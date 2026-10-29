// The step walkthrough: one step at a time, read top to bottom, with one clear next action.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Crumbs, RiskPill, cleanError, plural, reviewCrumbs, sizeText, usePref } from '../components/ui.tsx';
import { DiffHunk, type DiffMode } from '../components/diff.tsx';
import { ChecksCard, StackBar } from '../components/github.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { OUTSIDE_HINT, isReviewed } from '../../shared/order.ts';
import { buildPlan, decisionLabels, isCareful, resumePoint, settleComment, type PlanDecision } from '../../shared/plan.ts';
import type { ReviewData, ReviewPatch, ReviewState, Step } from '../../shared/types.ts';
import { AskPanel } from '../components/ask.tsx';
import { Markdown } from '../components/markdown.tsx';
import { useCodeSearch } from '../components/search.tsx';
import { AgentTests, AskedFor, CommentBox, whyFallback } from './Review.tsx';

export function Walkthrough({ go, data, initialState, stepKey, decision }: { go: Go; data: ReviewData; initialState: ReviewState; stepKey?: string; decision?: string }) {
  const [state, setState] = useState(initialState);
  const plan = useMemo(() => buildPlan(data, state), [data, state.order]);
  const steps = plan.sequence;
  // Where you are comes from the route, so back and forward move between steps and decisions.
  // Opened without a place ("Continue review"): the first thing not done yet, decisions first.
  const [start] = useState(() => (stepKey || decision ? null : resumePoint(plan, state)));
  const startKey = start?.stepKey ?? steps[0]?.key;
  const decisionId = decision ?? (stepKey ? undefined : start?.decision?.id);
  const dec = decisionId ? (plan.decisions.find((d) => d.id === decisionId) ?? null) : null;
  const decPos = dec ? plan.decisions.indexOf(dec) : -1;
  const selKey = dec ? (stepKey && dec.stepKeys.includes(stepKey) ? stepKey : dec.stepKeys[0]) : (stepKey ?? startKey);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // A check you weren't sure about, ready to ask Claude on that step.
  const [askDraft, setAskDraft] = useState<{ stepKey: string; text: string } | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [commentKey, setCommentKey] = useState(0);
  const [showContext, setShowContext] = usePref<boolean>('walkthrough-context', true);
  const [mode, setMode] = usePref<DiffMode>('diff-mode', 'unified');
  const [ignoreSpace, setIgnoreSpace] = usePref<boolean>('diff-ignore-space', false);
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

  const at = (to: { stepKey?: string; decision?: string }) => go({ name: 'review', projectId: data.projectId, branch: data.branch, ...to });
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
  const keys = useRef({ looksGood: () => {} });

  // j/k between steps, r looks good, c comments, a asks Claude, s switches the diff layout, w hides whitespace edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      if (!cur && !dec) return;
      // While deciding, next and back go through the decisions.
      const moves: Record<string, () => void> = dec
        ? { j: nextDecision, k: prevDecision, r: () => (state.settled?.[dec.id] ? nextDecision() : settle(dec, 'fine')) }
        : { j: () => pos < steps.length - 1 && select(steps[pos + 1].key), k: () => pos > 0 && select(steps[pos - 1].key), r: () => keys.current.looksGood() };
      const act: Record<string, () => void> = cur
        ? { ...moves, c: () => openComment(), a: () => openAsk(), s: () => setMode(mode === 'split' ? 'unified' : 'split'), w: () => setIgnoreSpace(!ignoreSpace) }
        : { j: moves.j, k: moves.k };
      const fn = act[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
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
  const here = dec
    ? `Decision ${decPos + 1} of ${plan.decisions.length}`
    : cur
      ? `${careful ? 'Read closely' : 'Skim'} · step ${phaseList.findIndex((s) => s.key === cur.key) + 1} of ${phaseList.length}`
      : '';

  const header = (
    <header className="topbar" style={{ borderBottomColor: 'var(--divider)' }}>
      <Brand onClick={() => go({ name: 'home' })} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 280px', minWidth: 0 }}>
        <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, onClick: toPlan, shrink: true }, { label: here }]} />
        <span className="topbar-sub">
          {data.pr ? `PR #${data.pr.number} · ` : ''}
          {data.stack ? `part ${data.stack.prs.findIndex((p) => p.current) + 1} of ${data.stack.prs.length} in a stack · ` : ''}
          {sizeText(data.files, data.added, data.removed)}
        </span>
      </div>
      {search.button}
      <button type="button" className="btn" style={{ height: 36 }} onClick={toPlan}>
        Review plan
      </button>
      {cur && (
        <button type="button" className="btn" style={{ height: 36 }} aria-pressed={showContext} onClick={() => setShowContext(!showContext)}>
          {showContext ? 'Hide context' : 'Context'}
        </button>
      )}
      <button type="button" className="btn primary" style={{ height: 36 }} onClick={() => go({ name: 'finish', projectId: data.projectId, branch: data.branch })}>
        Finish
      </button>
    </header>
  );

  // One segment per decision or step: click one to go there.
  const progressNav = (
    <nav aria-label="Review progress" style={{ padding: '8px 24px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {phases.map((p) => {
        const n = p.segments.length;
        const done = p.segments.filter((x) => x.done).length;
        return (
          <div key={p.label} style={{ flex: `${Math.max(3, Math.min(n, 12))} 1 160px`, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', gap: 3, width: '100%' }}>
              {n <= 40 ? (
                p.segments.map((x) => (
                  <button key={x.key} type="button" title={x.title} aria-label={x.title} aria-current={x.current ? 'step' : undefined} onClick={x.onClick} style={{ flex: 1, minWidth: 0, padding: '4px 0', border: 0, background: 'none', cursor: 'pointer' }}>
                    <span style={{ display: 'block', height: 6, borderRadius: 3, background: x.done ? 'var(--accent)' : x.current ? 'var(--accent-soft)' : 'var(--border)', outline: x.current ? '2px solid var(--accent)' : undefined, outlineOffset: 1 }} />
                  </button>
                ))
              ) : (
                <span style={{ flex: 1, height: 6, margin: '4px 0', borderRadius: 3, background: `linear-gradient(to right, var(--accent) ${(done / n) * 100}%, var(--border) 0)` }} />
              )}
            </span>
            <button type="button" onClick={p.onClick} style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', fontSize: 12.5, fontWeight: p.now ? 600 : 400, color: p.now ? 'var(--text)' : 'var(--muted)' }}>
              {p.label} · {done === n ? `all ${n} done` : `${done} of ${n} done`}
            </button>
          </div>
        );
      })}
    </nav>
  );

  // The decision you came for sits in the footer, where "Looks good" is for a step: in reach after reading the code.
  const decided = dec ? state.settled?.[dec.id] : undefined;
  const decLabels = dec ? decisionLabels(dec) : null;
  const decisionActions = dec && decLabels && (
    decided ? (
      <>
        <span style={{ fontSize: 14, fontWeight: 600, color: decided === 'fine' ? 'var(--low-fg)' : 'var(--med-fg)' }}>✓ {decided === 'fine' ? decLabels.fineDone : decLabels.fixDone}</span>
        <button type="button" className="link" style={{ fontSize: 13.5 }} onClick={() => settle(dec, null)}>
          Change
        </button>
        <button type="button" className="btn lg primary" style={{ minWidth: 170 }} onClick={nextDecision}>
          {plan.decisions[decPos + 1] ? 'Next decision →' : 'On to the steps →'}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="btn lg" onClick={() => settle(dec, 'fix')}>
          {decLabels.fix}
        </button>
        <button type="button" className="btn lg primary" style={{ minWidth: 150 }} onClick={() => settle(dec, 'fine')}>
          {decLabels.fine} →
        </button>
        <button type="button" className="link" style={{ fontSize: 13.5 }} onClick={nextDecision}>
          Decide later
        </button>
      </>
    )
  );

  // The header and the progress stay in view while you scroll: there's always a way to see what's left.
  const top = (
    <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>
      {header}
      {progressNav}
      {search.panel}
    </div>
  );

  if (dec && !cur) return <DecisionPage d={dec} n={decPos + 1} of={plan.decisions.length} data={data} top={top} onBack={prevDecision} actions={decisionActions} error={error} />;

  if (!cur) {
    return (
      <div className="page">
        <header className="topbar">
          <Brand onClick={() => go({ name: 'home' })} />
        </header>
        <p style={{ padding: 24 }}>This branch has no changes to review.</p>
      </div>
    );
  }

  const done = isReviewed(cur, state.reviewed);
  const stepExchanges = (state.exchanges ?? []).filter((e) => e.stepKey === cur.key);
  const earlier = since?.earlierComments[cur.key] ?? [];
  const stepComment = state.comments.find((c) => c.stepKey === cur.key && !c.line)?.body ?? '';
  // The decision you came for first.
  const stepFlags = [...plan.decisions, ...plan.notes].filter((d) => d.stepKeys.includes(cur.key)).sort((a, b) => Number(b.id === dec?.id) - Number(a.id === dec?.id));
  const answers = state.answers?.[cur.key] ?? {};
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

  const answer = async (index: number, value: 'yes' | 'unsure') => {
    const same = answers[index] === value;
    await patch({ type: 'answer', stepKey: cur.key, index, value: same ? null : value });
    if (value === 'unsure' && !same) {
      const line = `Not sure: ${cur.checks[index]}`;
      if (!stepComment.includes(line)) {
        await patch({ type: 'comment', stepKey: cur.key, body: stepComment.trim() ? `${stepComment.trim()}\n${line}` : line });
        setCommentKey((k) => k + 1);
      }
      setCommenting(true);
      setAskDraft({ stepKey: cur.key, text: cur.checks[index] });
      setAsking(true);
    }
  };


  return (
    <div className="page" style={{ background: 'var(--surface)' }}>
      {top}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'center', gap: 24, flex: 1 }}>
        <main style={{ flex: '999 1 560px', minWidth: 0, maxWidth: 920, padding: '32px 24px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', fontSize: 13, color: 'var(--muted)' }}>
              <span style={{ fontWeight: 600 }}>{here}</span>
              <RiskPill risk={cur.risk} />
              {cur.outsideTask && (
                <span className="pill medium" title={OUTSIDE_HINT}>
                  Outside your request
                </span>
              )}
              {done && <span className="pill low">Reviewed</span>}
              {since?.byStep[cur.key] && since.byStep[cur.key] !== 'same' && <span className="pill accent">{since.byStep[cur.key] === 'new' ? 'New' : 'Changed'} since last review</span>}
            </div>
            <h1 style={{ fontSize: 28, lineHeight: 1.25, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>{cur.title}</h1>
            <p style={{ fontSize: 16.5, lineHeight: 1.65, color: cur.why ? 'var(--text-body)' : 'var(--muted)', maxWidth: 760 }}>{cur.why || whyFallback(cur, data)}</p>
          </div>

          {stepFlags.length > 0 && (
            <section className="notice" style={{ flexDirection: 'column', gap: 10 }}>
              {stepFlags.map((f) => {
                const labels = decisionLabels(f);
                const value = state.settled?.[f.id];
                return (
                  <div key={f.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center' }}>
                    <span style={{ flex: '1 1 320px', minWidth: 0, overflowWrap: 'anywhere' }}>
                      <strong>{f.title}.</strong> {f.detail}
                    </span>
                    {f.id === dec?.id && f.stepKeys.length > 1 && (
                      <span style={{ order: 3, flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 13 }}>
                        In
                        {f.stepKeys.map((k) => {
                          const s = data.steps.find((x) => x.key === k);
                          return s ? (
                            <button key={k} type="button" className="link" aria-current={k === cur.key ? 'step' : undefined} style={{ fontSize: 13, fontWeight: k === cur.key ? 700 : 500 }} onClick={() => at({ decision: f.id, stepKey: k })}>
                              step {s.index + 1}
                            </button>
                          ) : null;
                        })}
                      </span>
                    )}
                    {f.id === dec?.id ? null : value ? (
                      <span style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}>
                        <span style={{ fontWeight: 600 }}>✓ {value === 'fine' ? labels.fineDone : labels.fixDone}</span>
                        <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => settle(f, null)}>
                          Change
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn" style={{ height: 32, fontSize: 13 }} onClick={() => settle(f, 'fine')}>
                          {labels.fine}
                        </button>
                        <button type="button" className="btn" style={{ height: 32, fontSize: 13 }} onClick={() => settle(f, 'fix')}>
                          {labels.fix}
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {earlier.length > 0 && (
            <section className="notice info" style={{ flexDirection: 'column', gap: 6 }}>
              <strong>What you said here last time</strong>
              {earlier.map((c) => (
                <div key={c.id} style={{ overflowWrap: 'anywhere' }}>
                  {c.path && c.line ? <span className="mono" style={{ fontSize: 12.5 }}>{`${c.path}:${c.line}`}</span> : null}
                  <Markdown text={c.body} />
                </div>
              ))}
            </section>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span className="muted">
              {plural(cur.files.length, 'file')} · {plural(cur.hunkIds.length, 'change')}
            </span>
            <span style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <span role="group" aria-label="Diff layout" style={{ display: 'inline-flex', border: '1px solid var(--border-strong)', borderRadius: 8, overflow: 'hidden' }}>
                {(['unified', 'split'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} style={{ border: 0, padding: '5px 12px', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: mode === m ? 'var(--accent-soft)' : 'var(--surface)', color: mode === m ? 'var(--accent)' : 'var(--text)' }}>
                    {m === 'unified' ? 'Unified' : 'Side by side'}
                  </button>
                ))}
              </span>
              <label className="choice" style={{ alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={ignoreSpace} onChange={(e) => setIgnoreSpace(e.target.checked)} style={{ marginTop: 0 }} />
                Hide whitespace
              </label>
            </span>
          </div>

          {cur.hunkIds.map((id) => {
            const h = data.hunks[id];
            if (!h) return null;
            const isNew = since && !since.before.has(id);
            return (
              <DiffHunk
                key={`${cur.key}:${id}`}
                hunk={h}
                mode={mode}
                ignoreSpace={ignoreSpace}
                comments={state.comments.filter((c) => c.hunkId === id && c.line)}
                onComment={lineComment(id, h.path)}
                loadLines={(side, from, to) => window.api.fileLines(data.projectId, data.branch, side === 'old' ? (h.oldPath ?? h.path) : h.path, side, from, to)}
                collapsed={since?.reviewedBefore.has(id) ? 'You reviewed this exact change last time.' : null}
                badge={isNew ? <span className="pill accent" style={{ border: 0, fontSize: 11 }}>New since last review</span> : null}
                noteBy={data.walkthrough === 'reviewer' ? 'reviewer' : 'agent'}
              />
            );
          })}

          {cur.checks.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 16 }}>{cur.checks.length === 1 ? 'One question for you' : `${cur.checks.length === 2 ? 'Two' : cur.checks.length === 3 ? 'Three' : cur.checks.length} questions for you`}</h2>
              {cur.checks.map((q, i) => (
                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ flex: '1 1 360px', fontSize: 14.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                    <Markdown text={q} />
                  </div>
                  <span role="group" aria-label="Your answer" style={{ display: 'flex', gap: 6 }}>
                    <button type="button" aria-pressed={answers[i] === 'yes'} className={`btn ${answers[i] === 'yes' ? 'done' : ''}`} style={{ height: 34, padding: '0 14px' }} onClick={() => answer(i, 'yes')}>
                      Looks right
                    </button>
                    <button
                      type="button"
                      aria-pressed={answers[i] === 'unsure'}
                      className="btn"
                      style={{ height: 34, padding: '0 14px', ...(answers[i] === 'unsure' ? { background: 'var(--med-bg)', color: 'var(--med-fg)', borderColor: 'var(--med-border)', fontWeight: 600 } : {}) }}
                      onClick={() => answer(i, 'unsure')}
                    >
                      Not sure
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}

          {(asking || stepExchanges.length > 0) && (
            <AskPanel
              key={`ask:${cur.key}`}
              data={data}
              step={cur}
              exchanges={stepExchanges}
              draft={askDraft?.stepKey === cur.key ? askDraft.text : undefined}
              onShowChanges={() => go({ name: 'review', projectId: data.projectId, branch: data.branch, stepKey: cur.key, reload: Date.now() })}
            />
          )}

          {(commenting || stepComment) && (
            <CommentBox key={`${cur.key}:${commentKey}`} initial={stepComment} onSave={(body) => patch({ type: 'comment', stepKey: cur.key, body })} />
          )}
          {error && <p className="error">{error}</p>}
        </main>

        {showContext && (
          <aside aria-label="Context" style={{ flex: '1 1 300px', maxWidth: 360, padding: '32px 24px 32px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 className="label">{data.prompt || !data.pr ? 'What you asked for' : 'Pull request description'}</h2>
              <AskedFor data={data} clamp={400} />
              {data.session && (
                <button type="button" className="link" style={{ fontSize: 13, fontWeight: 500, textAlign: 'left' }} onClick={() => window.api.openSessionFile(data.session!.file)}>
                  Open full agent session
                </button>
              )}
            </section>
            {data.agentTests && (
              <section className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: 1.5 }}>
                <h2 className="label">The agent’s tests</h2>
                <AgentTests data={data} />
              </section>
            )}
            {data.stack && (
              <section className="card" style={{ padding: '16px 18px' }}>
                <StackBar data={data} go={go} />
              </section>
            )}
            <ChecksCard data={data} />
          </aside>
        )}
      </div>

      <footer style={{ position: 'sticky', bottom: 0, zIndex: 4, background: 'var(--surface)', borderTop: '1px solid var(--divider)', padding: '12px 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn lg" disabled={!dec && pos === 0} onClick={() => (dec ? prevDecision() : select(steps[pos - 1].key))}>
          ← Back
        </button>
        <button type="button" className="btn lg" onClick={openComment}>
          Comment
        </button>
        {!asking && !stepExchanges.length && (
          <button type="button" className="btn lg" onClick={openAsk}>
            Ask Claude
          </button>
        )}
        {dec ? (
          decisionActions
        ) : (
          <button type="button" className={`btn lg ${done ? 'done' : 'primary'}`} style={{ minWidth: 170 }} onClick={looksGood}>
            {done ? (pos < steps.length - 1 ? 'Reviewed · next →' : 'Reviewed ✓') : 'Looks good →'}
          </button>
        )}
        <span style={{ display: 'flex', gap: 10, fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }} aria-label="Keyboard shortcuts">
          {[['j', 'next'], ['k', 'back'], ['r', decLabels ? (decided ? 'next decision' : decLabels.fine.toLowerCase()) : 'looks good'], ['c', 'comment'], ['a', 'ask']].map(([k, what]) => (
            <span key={k}>
              <span className="kbd">{k}</span> {what}
            </span>
          ))}
        </span>
      </footer>
    </div>
  );
}

/** A decision with no step to show, like failing CI: what it is, where to look, and the choice. */
function DecisionPage(props: {
  d: PlanDecision;
  n: number;
  of: number;
  data: ReviewData;
  top: React.ReactNode;
  onBack: () => void;
  actions: React.ReactNode;
  error: string | null;
}) {
  const { d, data } = props;
  const failing = data.pr?.checks.find((c) => c.state === 'fail' && c.url);
  return (
    <div className="page" style={{ background: 'var(--surface)' }}>
      {props.top}
      <main style={{ width: '100%', maxWidth: 920, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
          Decision {props.n} of {props.of}
        </span>
        <h1 style={{ fontSize: 28, lineHeight: 1.25, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>{d.title}</h1>
        <p style={{ fontSize: 16.5, lineHeight: 1.65, color: 'var(--text-body)', maxWidth: 760 }}>{d.detail}</p>
        {d.places.length > 1 && (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {d.places.map((p, i) => (
              <li key={i} style={{ overflowWrap: 'anywhere' }}>{p}</li>
            ))}
          </ul>
        )}
        {d.kind === 'ci' && data.pr && (
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => window.api.openExternal(failing?.url ?? data.pr!.url)}>
            Open checks ↗
          </button>
        )}
        {props.error && <p className="error">{props.error}</p>}
      </main>
      <footer style={{ position: 'sticky', bottom: 0, zIndex: 4, background: 'var(--surface)', borderTop: '1px solid var(--divider)', padding: '12px 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn lg" onClick={props.onBack}>
          ← Back
        </button>
        {props.actions}
      </footer>
    </div>
  );
}
