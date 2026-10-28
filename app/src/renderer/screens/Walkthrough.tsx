// The step walkthrough: one step at a time, read top to bottom, with one clear next action.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, RiskPill, cleanError, plural, sizeText, usePref } from '../components/ui.tsx';
import { DiffHunk, type DiffMode } from '../components/diff.tsx';
import { ChecksCard, StackBar } from '../components/github.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { isReviewed } from '../../shared/order.ts';
import { buildPlan, isCareful, planProgress } from '../../shared/plan.ts';
import type { ReviewData, ReviewPatch, ReviewState } from '../../shared/types.ts';
import { AskPanel } from '../components/ask.tsx';
import { AskedFor, CommentBox, whyFallback } from './Review.tsx';

export function Walkthrough({ go, data, initialState, initialStep }: { go: Go; data: ReviewData; initialState: ReviewState; initialStep?: string }) {
  const [state, setState] = useState(initialState);
  const plan = useMemo(() => buildPlan(data, state), [data, state.order]);
  const steps = plan.sequence;
  const firstOpen = steps.find((s) => !isReviewed(s, state.reviewed)) ?? steps[0];
  const [selKey, setSelKey] = useState(initialStep ?? firstOpen?.key);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [commentKey, setCommentKey] = useState(0);
  const [showContext, setShowContext] = usePref<boolean>('walkthrough-context', false);
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
  const cur = steps[pos];
  const progress = planProgress(plan, state);

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

  const select = (key: string) => {
    setSelKey(key);
    setAsking(false);
    setCommenting(false);
    window.scrollTo(0, 0);
  };

  const toPlan = () => go({ name: 'plan', projectId: data.projectId, branch: data.branch });
  const keys = useRef({ looksGood: () => {} });

  // j/k between steps, r looks good, c comments, a asks Claude, s switches the diff layout, w hides whitespace edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      if (!steps[pos]) return;
      const act: Record<string, () => void> = {
        j: () => pos < steps.length - 1 && select(steps[pos + 1].key),
        k: () => pos > 0 && select(steps[pos - 1].key),
        r: () => keys.current.looksGood(),
        c: () => openComment(),
        a: () => openAsk(),
        s: () => setMode(mode === 'split' ? 'unified' : 'split'),
        w: () => setIgnoreSpace(!ignoreSpace),
      };
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
  const careful = isCareful(cur);
  const phaseSteps = careful ? plan.careful : plan.skim;
  const phasePos = phaseSteps.findIndex((s) => s.key === cur.key);
  const stepExchanges = (state.exchanges ?? []).filter((e) => e.stepKey === cur.key);
  const earlier = since?.earlierComments[cur.key] ?? [];
  const stepComment = state.comments.find((c) => c.stepKey === cur.key && !c.line)?.body ?? '';
  const stepFlags = plan.decisions.filter((d) => d.stepKeys.includes(cur.key));
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
    }
  };

  const phases = [
    { label: 'Decide', n: progress.decisions, done: progress.decided, now: false, onClick: toPlan },
    { label: 'Look carefully', n: progress.careful, done: progress.carefulDone, now: careful, onClick: () => plan.careful[0] && select((plan.careful.find((s) => !isReviewed(s, state.reviewed)) ?? plan.careful[0]).key) },
    { label: 'Skim', n: progress.skim, done: progress.skimDone, now: !careful, onClick: () => plan.skim[0] && select((plan.skim.find((s) => !isReviewed(s, state.reviewed)) ?? plan.skim[0]).key) },
  ].filter((p) => p.n > 0);

  return (
    <div className="page" style={{ background: 'var(--surface)' }}>
      <header className="topbar" style={{ gap: '12px 20px', padding: '12px 24px', borderBottomColor: 'var(--divider)' }}>
        <Brand onClick={() => go({ name: 'home' })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 280px', minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={data.title}>
            {data.title}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {data.pr ? `PR #${data.pr.number} · ` : ''}
            {data.stack ? `part ${data.stack.prs.findIndex((p) => p.current) + 1} of ${data.stack.prs.length} in a stack · ` : ''}
            {sizeText(data.files, data.added, data.removed)}
          </span>
        </div>
        <button type="button" className="btn" style={{ height: 36 }} onClick={toPlan}>
          Review plan
        </button>
        <button type="button" className="btn" style={{ height: 36 }} aria-pressed={showContext} onClick={() => setShowContext(!showContext)}>
          {showContext ? 'Hide context' : 'Context'}
        </button>
        <button type="button" className="btn primary" style={{ height: 36 }} onClick={() => go({ name: 'finish', projectId: data.projectId, branch: data.branch })}>
          Finish
        </button>
      </header>

      <nav aria-label="Review progress" style={{ padding: '12px 24px', borderBottom: '1px solid var(--divider)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {phases.map((p) => (
          <button key={p.label} type="button" onClick={p.onClick} style={{ flex: `${Math.max(3, Math.min(p.n, 12))} 1 160px`, display: 'flex', flexDirection: 'column', gap: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
            <span style={{ display: 'flex', gap: 3, height: 6, width: '100%' }}>
              {p.n <= 40 ? (
                Array.from({ length: p.n }, (_, i) => <span key={i} style={{ flex: 1, borderRadius: 3, background: i < p.done ? 'var(--accent)' : 'var(--border)' }} />)
              ) : (
                <span style={{ flex: 1, borderRadius: 3, background: `linear-gradient(to right, var(--accent) ${(p.done / p.n) * 100}%, var(--border) 0)` }} />
              )}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: p.now ? 600 : 400, color: p.now ? 'var(--text)' : 'var(--muted)' }}>
              {p.label} · {p.done === p.n ? `all ${p.n} done` : `${p.done} of ${p.n}`}
            </span>
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'center', gap: 24, flex: 1 }}>
        <main style={{ flex: '999 1 560px', minWidth: 0, maxWidth: 920, padding: '32px 24px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', fontSize: 13, color: 'var(--muted)' }}>
              <span style={{ fontWeight: 600 }}>
                {careful ? 'Look carefully' : 'Skim'} · {phasePos + 1} of {phaseSteps.length}
              </span>
              <RiskPill risk={cur.risk} />
              {cur.outsideTask && <span className="pill medium">Outside the task</span>}
              {done && <span className="pill low">Reviewed</span>}
              {since?.byStep[cur.key] && since.byStep[cur.key] !== 'same' && <span className="pill accent">{since.byStep[cur.key] === 'new' ? 'New' : 'Changed'} since last review</span>}
            </div>
            <h1 style={{ fontSize: 28, lineHeight: 1.25, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>{cur.title}</h1>
            <p style={{ fontSize: 16.5, lineHeight: 1.65, color: cur.why ? 'var(--text-body)' : 'var(--muted)', maxWidth: 760 }}>{cur.why || whyFallback(cur, data)}</p>
          </div>

          {stepFlags.length > 0 && (
            <section className="notice" style={{ flexDirection: 'column', gap: 4 }}>
              {stepFlags.map((f) => (
                <span key={f.id}>
                  <strong>{f.title}.</strong> {state.settled?.[f.id] === 'fine' ? 'You said it’s fine.' : state.settled?.[f.id] === 'fix' ? (f.kind === 'outside' ? 'You chose to drop it.' : 'You said it needs a fix.') : f.detail}
                </span>
              ))}
            </section>
          )}

          {earlier.length > 0 && (
            <section className="notice info" style={{ flexDirection: 'column', gap: 6 }}>
              <strong>What you said here last time</strong>
              {earlier.map((c) => (
                <span key={c.id} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {c.path && c.line ? <span className="mono" style={{ fontSize: 12.5 }}>{`${c.path}:${c.line} `}</span> : null}
                  {c.body}
                </span>
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
                  <span style={{ flex: '1 1 360px', fontSize: 14.5, lineHeight: 1.5 }}>{q}</span>
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
        <button type="button" className="btn lg" disabled={pos === 0} onClick={() => select(steps[pos - 1].key)}>
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
        <button type="button" className={`btn lg ${done ? 'done' : 'primary'}`} style={{ minWidth: 170 }} onClick={looksGood}>
          {done ? (pos < steps.length - 1 ? 'Reviewed · next →' : 'Reviewed ✓') : 'Looks good →'}
        </button>
        <span style={{ display: 'flex', gap: 10, fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }} aria-label="Keyboard shortcuts">
          {[['j', 'next'], ['k', 'back'], ['r', 'looks good'], ['c', 'comment'], ['a', 'ask']].map(([k, what]) => (
            <span key={k}>
              <span className="kbd">{k}</span> {what}
            </span>
          ))}
        </span>
      </footer>
    </div>
  );
}
