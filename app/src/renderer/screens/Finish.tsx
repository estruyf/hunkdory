import { useState } from 'react';
import type { Go } from '../App.tsx';
import { LoadingPage, Stat, cleanError, plural, useAsync } from '../components/ui.tsx';
import { ReviewError } from './Review.tsx';
import { isReviewed } from '../../shared/order.ts';
import { defaultDrops } from '../../shared/plan.ts';
import type { Decision, GitHubEvent, ReviewData, ReviewState } from '../../shared/types.ts';

const EVENTS: { id: GitHubEvent; title: string }[] = [
  { id: 'COMMENT', title: 'Comment' },
  { id: 'APPROVE', title: 'Approve' },
  { id: 'REQUEST_CHANGES', title: 'Request changes' },
];

export function Finish({ go, projectId, branch }: { go: Go; projectId: string; branch: string }) {
  const loaded = useAsync(() => window.api.loadReview(projectId, branch), [projectId, branch]);
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!loaded.value) return <LoadingPage onHome={() => go({ name: 'home' })} label="Reading the branch…" detail={branch} />;
  return <FinishForm go={go} data={loaded.value.data} state={loaded.value.state} />;
}

function FinishForm({ go, data, state }: { go: Go; data: ReviewData; state: ReviewState }) {
  const outside = data.steps.filter((s) => s.outsideTask);
  const [drop, setDrop] = useState<Set<string>>(() => new Set(defaultDrops(data.steps, state.settled)));
  const comments = state.comments.filter((c) => c.body.trim());
  const agent = data.session ? 'claude' : data.agent === 'copilot' ? 'copilot' : null;
  const [pick, setPick] = useState<Decision>(() => (agent && (comments.length || drop.size) ? 'send-back' : data.pr ? 'github' : agent ? 'send-back' : 'merge'));
  const [event, setEvent] = useState<GitHubEvent>(() => (comments.length ? 'COMMENT' : 'APPROVE'));
  const [note, setNote] = useState('');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCommit, setNeedsCommit] = useState<number | null>(null);
  // A local branch on a linked GitHub repo can become a pull request instead of a local merge.
  const canOpenPr = !data.pr && data.local && !!data.repo;
  const [openPr, setOpenPr] = useState(canOpenPr);
  const [prTitle, setPrTitle] = useState(data.title);
  const [draft, setDraft] = useState(false);
  const opening = canOpenPr && openPr && pick === 'merge';

  const reviewed = data.steps.filter((s) => isReviewed(s, state.reviewed)).length;
  const minutes = state.startedAt ? Math.max(1, Math.round((Date.now() - Date.parse(state.startedAt)) / 60000)) : null;
  const dropping = pick === 'send-back' ? data.steps.filter((s) => drop.has(s.key)) : [];
  const base = data.baseRef.replace(/^origin\//, '');
  const stepLabel = (key: string) => {
    const s = data.steps.find((x) => x.key === key);
    return s ? `Step ${s.index + 1} · ${s.files.length === 1 ? s.files[0] : s.title}` : 'Removed step';
  };

  const options: { id: Decision; title: string; detail: string; submit: string; disabled?: string }[] = [
    {
      id: 'merge',
      title: 'Approve and merge',
      detail: data.pr
        ? `Approves pull request #${data.pr.number} on GitHub${comments.length ? ` with your ${plural(comments.length, 'comment')}` : ''} and merges it into ${data.pr.baseRefName}.`
        : canOpenPr && openPr
          ? `Pushes ${data.branch} and opens a pull request into ${base}, with your comments in the description. Nothing is merged yet.`
          : `Merge into ${base} as it is. Your comments stay in Reviewer.`,
      submit: data.pr ? 'Approve & merge' : canOpenPr && openPr ? 'Approve & open PR' : 'Approve & merge',
    },
    ...(data.pr
      ? [
          {
            id: 'github' as const,
            title: `Post your review on PR #${data.pr.number}`,
            detail: `Your ${plural(comments.length, 'comment')} go on GitHub${comments.some((c) => c.line) ? ', line comments on their lines' : ''}. The PR leaves your inbox until it changes.`,
            submit: event === 'APPROVE' ? 'Approve on GitHub' : event === 'REQUEST_CHANGES' ? 'Request changes on GitHub' : 'Post review',
          },
        ]
      : []),
    agent === 'copilot'
      ? {
          id: 'send-back' as const,
          title: 'Send back to Copilot',
          detail: `Posts your review on PR #${data.pr!.number} asking @copilot to address it${dropping.length ? `, including dropping ${dropping.map((s) => `step ${s.index + 1}`).join(', ')}` : ''}. Copilot works on GitHub; the PR comes back here when it pushes.`,
          submit: 'Send to Copilot',
        }
      : {
          id: 'send-back' as const,
          title: 'Send back to the agent',
          detail: `Resumes the Claude Code session with your ${plural(comments.length, 'comment')}${dropping.length ? ` and asks it to drop ${dropping.map((s) => `step ${s.index + 1}`).join(', ')}` : ''}. It runs in the background and can edit files on the branch.`,
          submit: 'Send to agent',
          disabled: agent ? undefined : 'No Claude Code session on this Mac worked on this branch, so there is no agent to send it back to.',
        },
    {
      id: 'discard',
      title: data.local ? 'Discard the branch' : 'Close this review',
      detail: data.local ? 'Closes the change. The session stays in your history.' : 'Removes it from your inbox. Nothing changes in git or on GitHub.',
      submit: data.local ? 'Discard' : 'Close review',
    },
  ];
  const current = options.find((o) => o.id === pick)!;

  const submit = async (commitFirst = false) => {
    if (pick === 'discard' && deleteBranch && !window.confirm(`Delete ${data.branch}${''} and its worktree? Uncommitted changes in it are lost.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.finish({ projectId: data.projectId, branch: data.branch, kind: pick, note, dropStepKeys: pick === 'send-back' ? [...drop] : [], commitFirst, deleteBranch, event, openPr: opening ? { title: prTitle.trim() || data.title, draft } : undefined });
      if (res.ok) go({ name: 'done', projectId: data.projectId, branch: data.branch, result: res });
      else if (res.needsCommit) setNeedsCommit(res.needsCommit);
      else setError(res.message);
    } catch (e) {
      setError(cleanError(e));
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <header className="topbar split">
        <button type="button" className="link" style={{ fontSize: 14, fontWeight: 500 }} onClick={() => go({ name: 'plan', projectId: data.projectId, branch: data.branch })}>
          ← Back to the review
        </button>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Finish review</span>
        <span style={{ width: 130 }} />
      </header>

      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '32px 24px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 26, letterSpacing: '-0.015em', overflowWrap: 'anywhere' }}>{data.title}</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            {reviewed === data.steps.length ? `You reviewed all ${plural(data.steps.length, 'step')}` : `You reviewed ${reviewed} of ${plural(data.steps.length, 'step')}`}
            {minutes ? ` in ${plural(minutes, 'minute')}.` : '.'}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Stat value={`${reviewed} / ${data.steps.length}`} label="Steps reviewed" />
          <Stat value={comments.length} label={comments.length === 1 ? 'Comment' : 'Comments'} />
          <Stat value={dropping.length} label={dropping.length === 1 ? 'Step to drop' : 'Steps to drop'} tone={dropping.length ? 'warn' : undefined} />
        </div>

        <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="label">Your comments</h2>
          {comments.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No comments.</p>}
          {comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                {stepLabel(c.stepKey)}
                {c.path && c.line ? <span className="mono"> · {c.path}:{c.line}</span> : null}
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.body}</span>
            </div>
          ))}
          {outside.map((s) => (
            <label key={s.key} className={`choice ${pick === 'send-back' ? '' : 'off'}`} style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                disabled={pick !== 'send-back'}
                checked={drop.has(s.key)}
                onChange={(e) => {
                  const next = new Set(drop);
                  if (e.target.checked) next.add(s.key);
                  else next.delete(s.key);
                  setDrop(next);
                }}
                style={{ marginTop: 0 }}
              />
              <span>
                Drop step {s.index + 1} ({s.title}) from the branch
              </span>
            </label>
          ))}
          {outside.length > 0 && pick !== 'send-back' && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Dropping steps works with Send back for now: the agent reverts them.</p>}
        </section>

        <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <legend className="label" style={{ padding: 0, marginBottom: 6 }}>
              Your decision
            </legend>
            {options.map((o) => (
              <label
                key={o.id}
                className={o.disabled ? 'choice off' : 'choice'}
                style={{ gap: 12, padding: '14px 16px', borderRadius: 10, cursor: o.disabled ? 'default' : 'pointer', border: `1px solid ${pick === o.id ? 'var(--accent)' : 'var(--border)'}`, background: pick === o.id ? 'var(--accent-soft)' : 'var(--surface)' }}
              >
                <input type="radio" name="decision" disabled={!!o.disabled} checked={pick === o.id} onChange={() => { setPick(o.id); setNeedsCommit(null); setError(null); }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{o.title}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted)' }}>{o.disabled ?? o.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {pick === 'discard' && data.local && (
            <label className="choice">
              <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
              <span>Also delete the branch and its worktree</span>
            </label>
          )}
          {pick === 'github' && (
            <fieldset style={{ border: 0, margin: 0, padding: '4px 0 0', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <legend className="sr-only">Review type</legend>
              {EVENTS.map((e) => (
                <label key={e.id} className="choice" style={{ alignItems: 'center' }}>
                  <input type="radio" name="event" checked={event === e.id} onChange={() => setEvent(e.id)} style={{ marginTop: 0 }} />
                  {e.title}
                </label>
              ))}
            </fieldset>
          )}
          {(pick === 'send-back' || pick === 'github') && (
            <>
              <label htmlFor="note" style={{ fontSize: 13, fontWeight: 600, paddingTop: 4 }}>
                {pick === 'github' ? 'Review summary (optional)' : `Note to ${agent === 'copilot' ? 'Copilot' : 'the agent'} (optional)`}
              </label>
              <textarea id="note" rows={2} className="textarea" placeholder="Anything else it should know" value={note} onChange={(e) => setNote(e.target.value)} />
            </>
          )}
        </section>

        {canOpenPr && pick !== 'discard' && (
          <section className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="label">This is a branch, not a PR</h2>
            <label className={`choice ${pick === 'merge' ? '' : 'off'}`}>
              <input type="checkbox" disabled={pick !== 'merge'} checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} />
              <span>
                <strong>Open a pull request when I finish</strong>
                <br />
                <span className="muted">
                  {pick === 'merge'
                    ? `Creates a PR from ${data.branch} into ${base} on GitHub, with your comments in the description.`
                    : 'You can open it when you approve, after the agent’s next round.'}
                </span>
              </span>
            </label>
            {pick === 'merge' && openPr && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <input className="field" aria-label="Pull request title" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} style={{ flex: '1 1 320px' }} />
                <label className="choice" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} style={{ marginTop: 0 }} />
                  Open as draft
                </label>
              </div>
            )}
          </section>
        )}

        {needsCommit !== null && (
          <div className="notice" role="alert" style={{ flexDirection: 'column', gap: 10 }}>
            <span>
              <strong>{plural(needsCommit, 'file')} on this branch {needsCommit === 1 ? "isn't" : "aren't"} committed yet.</strong> {opening ? 'A pull request' : 'A merge'} only takes commits. Reviewer can commit them for you first, with "{data.title}" as the message. The <span className="mono">.review</span> folder stays out of the commit.
            </span>
            <span>
              <button type="button" className="btn primary" disabled={busy} onClick={() => submit(true)}>
                Commit {plural(needsCommit, 'file')} and {opening ? 'open the PR' : 'merge'}
              </button>
            </span>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn lg" onClick={() => go({ name: 'plan', projectId: data.projectId, branch: data.branch })}>
            Keep reviewing
          </button>
          <button type="button" className="btn lg primary" disabled={busy || !!current.disabled} onClick={() => submit(false)}>
            {busy ? 'Working…' : current.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
