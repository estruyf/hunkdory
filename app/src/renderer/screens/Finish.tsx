import { useState } from 'react';
import type { Go } from '../App.tsx';
import { Brand, Crumbs, LoadingPage, cleanError, plural, reviewCrumbs, useAsync } from '../components/ui.tsx';
import { ReviewError } from './Review.tsx';
import { Markdown } from '../components/markdown.tsx';
import { isReviewed } from '../../shared/order.ts';
import { buildPlan, defaultDrops, openItems } from '../../shared/plan.ts';
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
  const open = openItems(buildPlan(data, state), state);
  const [pick, setPick] = useState<Decision>(() => (agent && (comments.length || drop.size) ? 'send-back' : data.pr ? 'github' : agent ? 'send-back' : 'merge'));
  const [event, setEvent] = useState<GitHubEvent>(() => (open.fixes.length ? 'REQUEST_CHANGES' : comments.length || data.prByYou ? 'COMMENT' : 'APPROVE'));
  // Merging with something still open takes a second click.
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCommit, setNeedsCommit] = useState<number | null>(null);
  const [showComments, setShowComments] = useState(comments.length <= 3);
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
  const unfinished = [
    open.decisions.length && `${plural(open.decisions.length, 'decision')} not made yet: ${open.decisions.map((d) => d.title).join('; ')}.`,
    open.fixes.length && `You said ${open.fixes.length === 1 ? 'this needs' : 'these need'} a fix: ${open.fixes.map((d) => d.title).join('; ')}.`,
    open.careful.length && `${plural(open.careful.length, 'step')} to read closely ${open.careful.length === 1 ? 'is' : 'are'} not reviewed.`,
    open.skim.length && `${plural(open.skim.length, 'step')} to skim ${open.skim.length === 1 ? 'is' : 'are'} not reviewed.`,
  ].filter((x): x is string => !!x);
  const guarded = pick === 'merge' && unfinished.length > 0;
  const stepLabel = (key: string) => {
    const s = data.steps.find((x) => x.key === key);
    return s ? `Step ${s.index + 1} · ${s.files.length === 1 ? s.files[0] : s.title}` : 'Removed step';
  };

  const options: { id: Decision; title: string; detail: string; submit: string; disabled?: string }[] = [
    {
      id: 'merge',
      title: data.prByYou ? 'Merge' : 'Approve and merge',
      detail: data.prByYou
        ? `Merges your pull request #${data.pr!.number} into ${data.pr!.baseRefName}${comments.length ? `, with your ${plural(comments.length, 'comment')} on it` : ''}. GitHub doesn’t let you approve your own PR.`
        : data.pr
        ? `Approves pull request #${data.pr.number} on GitHub${comments.length ? ` with your ${plural(comments.length, 'comment')}` : ''} and merges it into ${data.pr.baseRefName}.`
        : canOpenPr && openPr
          ? `Pushes ${data.branch} and opens a pull request into ${base}, with your comments in the description. Nothing is merged yet.`
          : `Merge into ${base} as it is. Your comments stay in Hunkdory.`,
      submit: data.prByYou ? 'Merge' : data.pr ? 'Approve & merge' : canOpenPr && openPr ? 'Approve & open PR' : 'Approve & merge',
    },
    ...(data.pr
      ? [
          {
            id: 'github' as const,
            title: `Post your review on PR #${data.pr.number}`,
            detail: `${comments.length ? `Your ${plural(comments.length, 'comment')} ${comments.length === 1 ? 'goes' : 'go'} on GitHub, on the code ${comments.length === 1 ? "it's" : "they're"} about.` : 'Your review goes on GitHub.'} The PR leaves your inbox until it changes.`,
            submit: event === 'APPROVE' ? 'Approve on GitHub' : event === 'REQUEST_CHANGES' ? 'Request changes on GitHub' : 'Post review',
          },
        ]
      : []),
    agent === 'copilot'
      ? {
          id: 'send-back' as const,
          title: 'Send back to Copilot',
          detail: `Posts your review on PR #${data.pr!.number} asking @copilot to address it${dropping.length ? `, including dropping ${dropping.map((s) => `step ${s.index + 1}`).join(', ')}` : ''}. Copilot works on GitHub; the PR comes back here when it pushes.`,
          submit: 'Send back to Copilot',
        }
      : {
          id: 'send-back' as const,
          title: 'Send back to the agent',
          detail: `Resumes the Claude Code session with your ${plural(comments.length, 'comment')}${dropping.length ? ` and asks it to drop ${dropping.map((s) => `step ${s.index + 1}`).join(', ')}` : ''}. It runs in the background and can edit files on the branch.`,
          submit: 'Send back',
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

  // Deleting a branch with its worktree can't be undone: it takes a second click, like merging with work still open.
  const risky = pick === 'discard' && data.local && deleteBranch;
  const submit = async (commitFirst = false) => {
    if ((guarded || risky) && !confirming) {
      setConfirming(true);
      return;
    }
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

  const optionBody = (id: Decision) => {
    if (id === 'merge' && canOpenPr)
      return (
        <>
          <label className="choice">
            <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} />
            <span>
              <strong>Open a pull request instead of merging here</strong>
              <br />
              <span className="muted">
                Creates a PR from {data.branch} into {base} on GitHub, with your comments in the description.
              </span>
            </span>
          </label>
          {openPr && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <input className="field" aria-label="Pull request title" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} style={{ flex: '1 1 320px' }} />
              <label className="choice" style={{ alignItems: 'center' }}>
                <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} style={{ marginTop: 0 }} />
                Open as draft
              </label>
            </div>
          )}
        </>
      );
    if (id === 'github')
      return (
        <>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <legend className="sr-only">Review type</legend>
            {EVENTS.map((e) => (
              <label key={e.id} className="choice" style={{ alignItems: 'center', opacity: e.id === 'APPROVE' && data.prByYou ? 0.5 : undefined }} title={e.id === 'APPROVE' && data.prByYou ? 'GitHub doesn’t let you approve your own PR.' : undefined}>
                <input type="radio" name="event" checked={event === e.id} disabled={e.id === 'APPROVE' && data.prByYou} onChange={() => setEvent(e.id)} style={{ marginTop: 0 }} />
                {e.title}
              </label>
            ))}
          </fieldset>
          {noteField('Review summary (optional)')}
        </>
      );
    if (id === 'send-back')
      return (
        <>
          {outside.map((s) => (
            <label key={s.key} className="choice" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
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
                Drop step {s.index + 1} ({s.title}): you didn’t ask for it
              </span>
            </label>
          ))}
          {noteField(`Note to ${agent === 'copilot' ? 'Copilot' : 'the agent'} (optional)`)}
        </>
      );
    if (id === 'discard' && data.local)
      return (
        <label className="choice">
          <input
            type="checkbox"
            checked={deleteBranch}
            onChange={(e) => {
              setDeleteBranch(e.target.checked);
              setConfirming(false);
            }}
          />
          <span>Also delete the branch and its worktree</span>
        </label>
      );
    return null;
  };
  const noteField = (label: string) => (
    <>
      <label htmlFor="note" style={{ fontSize: 13, fontWeight: 600 }}>
        {label}
      </label>
      <textarea id="note" rows={2} className="textarea" placeholder="Anything else it should know" value={note} onChange={(e) => setNote(e.target.value)} />
    </>
  );

  return (
    <div className="page">
      <header className="topbar">
        <Brand onClick={() => go({ name: 'home' })} />
        <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, onClick: () => go({ name: 'plan', projectId: data.projectId, branch: data.branch }), shrink: true }, { label: 'Finish' }]} />
      </header>

      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '32px 24px 48px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 26, letterSpacing: '-0.015em', overflowWrap: 'anywhere' }}>{data.title}</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            {[`${reviewed} of ${plural(data.steps.length, 'step')} reviewed`, plural(comments.length, 'comment'), dropping.length ? `${plural(dropping.length, 'step')} to drop` : null, minutes ? plural(minutes, 'minute') : null].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* The decision first: it's what this page is for. Each option holds its own settings. */}
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="label" style={{ padding: 0, marginBottom: 10 }}>
            What do you want to do?
          </legend>
          {options.map((o) => {
            const on = pick === o.id;
            const body = on && !o.disabled ? optionBody(o.id) : null;
            return (
              <div key={o.id} className="option" data-on={on} style={o.disabled ? { opacity: 0.6 } : undefined}>
                <label className="choice" style={{ gap: 12, cursor: o.disabled ? 'default' : 'pointer' }}>
                  <input
                    type="radio"
                    name="decision"
                    disabled={!!o.disabled}
                    checked={on}
                    onChange={() => {
                      setPick(o.id);
                      setNeedsCommit(null);
                      setError(null);
                      setConfirming(false);
                    }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{o.title}</span>
                    <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted)' }}>{o.disabled ?? o.detail}</span>
                  </span>
                </label>
                {body && <div className="option-body">{body}</div>}
              </div>
            );
          })}
        </fieldset>

        <section className="card" style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button type="button" className="link" aria-expanded={showComments} disabled={!comments.length} onClick={() => setShowComments(!showComments)} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, color: comments.length ? 'var(--text)' : 'var(--muted)' }}>
            <span>{comments.length ? `Your ${plural(comments.length, 'comment')}` : 'No comments'}</span>
            {comments.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{showComments ? 'Hide' : 'Show'}</span>}
          </button>
          {showComments &&
            comments.map((c) => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  {stepLabel(c.stepKey)}
                  {c.path && c.line ? <span className="mono"> · {c.path}:{c.line}</span> : null}
                </span>
                <div style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                  <Markdown text={c.body} />
                </div>
              </div>
            ))}
        </section>

        {needsCommit !== null && (
          <div className="notice" role="alert" style={{ flexDirection: 'column', gap: 10 }}>
            <span>
              <strong>{plural(needsCommit, 'file')} on this branch {needsCommit === 1 ? "isn't" : "aren't"} committed yet.</strong> {opening ? 'A pull request' : 'A merge'} only takes commits. Hunkdory can commit them for you first, with "{data.title}" as the message. The <span className="mono">.review</span> folder stays out of the commit.
            </span>
            <span>
              <button type="button" className="btn primary" disabled={busy} onClick={() => submit(true)}>
                Commit {plural(needsCommit, 'file')} and {opening ? 'open the PR' : 'merge'}
              </button>
            </span>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {/* What's still open sits next to the button it holds back. */}
        {(guarded || (confirming && risky)) && (
          <div className="notice" role={confirming ? 'alert' : undefined} style={{ flexDirection: 'column', gap: 6 }}>
            {guarded ? (
              <>
                <strong>{confirming ? 'Merge with these still open?' : 'Not done yet'}</strong>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {unfinished.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </>
            ) : (
              <span>
                <strong>Delete {data.branch} and its worktree?</strong> Uncommitted changes in it are lost.
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn lg" onClick={() => go({ name: 'plan', projectId: data.projectId, branch: data.branch })}>
            Keep reviewing
          </button>
          <button type="button" className="btn lg primary" disabled={busy || !!current.disabled} onClick={() => submit(false)}>
            {busy ? 'Working…' : confirming && guarded ? 'Merge anyway' : confirming && risky ? 'Delete and discard' : current.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
