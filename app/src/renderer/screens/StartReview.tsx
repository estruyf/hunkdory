import { useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Later, LoadingPage, RiskPill, cleanError, plural, sizeText, useAsync } from '../components/ui.tsx';
import { AskedFor, ReviewError } from './Review.tsx';
import { WalkthroughNotice, useWalkthroughJob } from '../components/walkthrough.tsx';
import { StackBar, checksText, checksTone } from '../components/github.tsx';
import { sinceLastRound } from '../../shared/rounds.ts';
import { delta, orderSteps, timeAgo } from '../../shared/order.ts';
import type { ReviewOrder } from '../../shared/types.ts';

const ORDERS: { id: ReviewOrder; title: string; detail: string }[] = [
  { id: 'story', title: 'Story order', detail: 'How the change builds up' },
  { id: 'risk', title: 'Riskiest first', detail: "When you're short on time" },
  { id: 'file', title: 'By file', detail: 'The classic diff view' },
];

export function StartReview({ go, projectId, branch }: { go: Go; projectId: string; branch: string }) {
  const loaded = useAsync(() => window.api.loadReview(projectId, branch), [projectId, branch]);
  const [order, setOrder] = useState<ReviewOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipSeen, setSkipSeen] = useState(true);
  // Opening a branch without a walkthrough has Reviewer write one; the steps update when it's ready.
  const w = useWalkthroughJob(loaded.value?.data, { auto: true, onDone: loaded.reload });

  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!loaded.value) return <LoadingPage onHome={() => go({ name: 'home' })} label="Reading the branch…" detail={branch} />;
  const { data, state } = loaded.value;
  const chosen = order ?? state.order;
  const steps = orderSteps(data.steps, chosen);
  // Starting a finished review opens a new round; the decision you made becomes the last round.
  const since = sinceLastRound(data.steps, { rounds: [...(state.rounds ?? []), ...(state.decision ? [{ decision: state.decision, comments: state.comments, reviewed: state.reviewed }] : [])] });
  const counts = since ? Object.values(since.byStep).reduce((n, c) => ({ ...n, [c]: n[c] + 1 }), { new: 0, changed: 0, same: 0 }) : null;

  const start = async () => {
    try {
      let started = await window.api.updateReview(projectId, branch, { type: 'start', order: chosen });
      // Steps whose every change you reviewed before count as reviewed again.
      if (since && skipSeen) {
        for (const s of since.alreadyReviewed) started = await window.api.updateReview(projectId, branch, { type: 'reviewed', stepKey: s.key, hunkIds: s.hunkIds, on: true });
      }
      // Hand over what's already loaded, so the workspace opens at once.
      go({ name: 'plan', projectId, branch, preloaded: { data, state: started } });
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go({ name: 'home' })} />
        <span style={{ fontSize: 14, color: 'var(--muted)' }}>
          {data.projectName} / {data.branch}
        </span>
      </header>

      <div style={{ width: '100%', maxWidth: 1080, margin: '0 auto', padding: '32px 24px 48px', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Before you start</span>
            <h1 style={{ fontSize: 28, lineHeight: 1.25, letterSpacing: '-0.015em', overflowWrap: 'anywhere' }}>{data.title}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 13, color: 'var(--muted)' }}>
              <span className="mono">
                {data.branch} → {data.baseRef}
              </span>
              <span>
                {data.session
                  ? `Claude Code session last active ${timeAgo(data.session.endedAt)}`
                  : data.agent === 'copilot' && data.pr
                    ? `GitHub Copilot · PR #${data.pr.number}, updated ${timeAgo(data.pr.updatedAt)}`
                    : data.pr
                    ? `Pull request #${data.pr.number} by ${data.pr.author}, updated ${timeAgo(data.pr.updatedAt)}`
                    : data.author
                      ? `Last commit by ${data.author}`
                      : 'No agent session found'}
              </span>
              {data.pr && (
                <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => window.api.openExternal(data.pr!.url)}>
                  Open on GitHub ↗
                </button>
              )}
              <span>{sizeText(data.files, data.added, data.removed)}</span>
              {data.pr && data.pr.checks.length > 0 && <span className={`pill ${checksTone(data.pr.checks)}`} style={{ border: 0 }}>CI: {checksText(data.pr.checks)}</span>}
            </div>
          </div>

          <StackBar data={data} go={go} />

          {since && counts && (
            <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 className="label">Since your last review</h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
                {[counts.changed && `${plural(counts.changed, 'step')} changed`, counts.new && `${plural(counts.new, 'step')} new`, counts.same && `${counts.same} the same`].filter(Boolean).join(', ') || 'Nothing changed'}
                {since.gone ? `. ${plural(since.gone, 'earlier change')} ${since.gone === 1 ? 'is' : 'are'} gone, reverted or rewritten.` : '.'}{' '}
                <span className="muted">
                  You {since.decision.kind === 'send-back' ? 'sent it back' : since.decision.kind === 'github' ? 'reviewed it on GitHub' : 'finished it'} {timeAgo(since.decision.at)}.
                </span>
              </p>
              {since.alreadyReviewed.length > 0 && (
                <label className="choice" style={{ lineHeight: 1.45 }}>
                  <input type="checkbox" checked={skipSeen} onChange={(e) => setSkipSeen(e.target.checked)} />
                  <span>
                    Mark the {plural(since.alreadyReviewed.length, 'step')} you already reviewed as reviewed
                    <br />
                    <span className="muted">Every change in {since.alreadyReviewed.length === 1 ? 'it' : 'them'} is exactly what you saw last time.</span>
                  </span>
                </label>
              )}
            </section>
          )}

          <WalkthroughNotice data={data} w={w} />

          <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className="label">{data.prompt || !data.pr ? 'Your prompt' : 'Pull request description'}</h2>
            <AskedFor data={data} clamp={900} />
          </section>

          <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <h2 className="label">How the change splits up</h2>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>About {data.minutes} min</span>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {steps.map((s) => (
                <li key={s.key} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--divider)' }}>
                  <span style={{ width: 22, fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>{s.index + 1}</span>
                  <span style={{ flex: '1 1 260px', fontSize: 14.5, fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {s.title}
                    {s.outsideTask && s.source === 'chapter' && <span className="muted"> (outside your task)</span>}
                  </span>
                  {since && since.byStep[s.key] !== 'same' && <span className="pill accent">{since.byStep[s.key] === 'new' ? 'New' : 'Changed'}</span>}
                  <RiskPill risk={s.risk} />
                  <span style={{ width: 70, textAlign: 'right', fontSize: 13, color: 'var(--muted)' }}>{delta(s.added, s.removed)}</span>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <aside style={{ flex: '1 1 280px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <legend style={{ fontSize: 14, fontWeight: 600, padding: 0, marginBottom: 4 }}>Review order</legend>
              {ORDERS.map((o) => (
                <label key={o.id} className="choice" style={{ lineHeight: 1.45 }}>
                  <input type="radio" name="order" checked={chosen === o.id} onChange={() => setOrder(o.id)} />
                  <span>
                    <strong>{o.title}</strong>
                    <br />
                    <span className="muted">{o.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="choice off" style={{ paddingTop: 10, borderTop: '1px solid var(--divider)', lineHeight: 1.45 }}>
              <input type="checkbox" disabled />
              <span>
                Run tests before I start
                <Later />
              </span>
            </label>
            <label className="choice off" style={{ lineHeight: 1.45 }}>
              <input type="checkbox" disabled />
              <span>
                Check out the branch locally
                <Later />
              </span>
            </label>
          </section>
          <button type="button" className="btn xl primary" onClick={start}>
            {Object.keys(state.reviewed).length ? 'Continue review' : w.job?.status === 'running' && data.walkthrough === 'skeleton' ? 'Start with one step per file' : 'Start review'}
          </button>
          <button type="button" className="link" style={{ textAlign: 'center', fontSize: 14, fontWeight: 500 }} onClick={() => go({ name: 'home' })}>
            Not now
          </button>
          {error && <p className="error">{error}</p>}
        </aside>
      </div>
    </div>
  );
}
