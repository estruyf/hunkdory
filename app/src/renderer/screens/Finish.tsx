import { useEffect, useState } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, cleanError, isPlainKey, plural, reviewCrumbs, useAsync } from '../components/ui.tsx';
import { LoadingPage } from '../components/LoadingPage.tsx';
import { lastRead, readReview } from '../state/reviewReads.ts';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Radio, RadioGroup } from '../components/ui/Radio.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { FIELD, TEXTAREA } from '../components/ui/field.ts';
import { matches } from '../lib/shortcuts.ts';
import { useOnReturn, useTabActive } from '../state/tabPane.ts';
import { ReviewError } from './Review.tsx';
import { Markdown } from '../components/markdown.tsx';
import { PrLink } from '../components/github.tsx';
import { RunningWork } from '../components/RunningWork.tsx';
import { isReviewed } from '../../shared/order.ts';
import { buildPlan, defaultDrops, defaultReviewEvent, openItems, unpushedWork, vouchesForCode } from '../../shared/plan.ts';
import { commentParts, reviewedNote, sendableComments } from '../../shared/comments.ts';
import type { Comment, Decision, GitHubEvent, ReviewData, ReviewState } from '../../shared/types.ts';
import { thisComputer } from '../lib/platform.ts';

const EVENTS: { id: GitHubEvent; title: string }[] = [
  { id: 'COMMENT', title: 'Comment' },
  { id: 'APPROVE', title: 'Approve' },
  { id: 'REQUEST_CHANGES', title: 'Request changes' },
];

export function Finish({ go, projectId, branch }: { go: Go; projectId: string; branch: string }) {
  // What you saw last shows at once. Finishing reads the branch itself, so this can't merge something old.
  const [shown] = useState(() => lastRead(projectId, branch));
  const loaded = useAsync(() => readReview(projectId, branch), [projectId, branch]);
  useOnReturn(loaded.reload);
  const value = loaded.value ?? shown;
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!value) return <LoadingPage shape="plan" projectId={projectId} branch={branch} />;
  return <FinishForm go={go} data={value.data} state={value.state} />;
}

function FinishForm({ go, data, state: initialState }: { go: Go; data: ReviewData; state: ReviewState }) {
  // The branch as this page first showed it: your last read of it. Reading it again here, or on coming back to the tab, mustn't count as having seen what's new.
  const [seen] = useState(() => ({ headSha: data.headSha, hunkIds: Object.keys(data.hunks) }));
  // Removing a comment here updates the review, and what you finish with.
  const [state, setState] = useState(initialState);
  useEffect(() => setState(initialState), [initialState]);
  useEffect(
    () =>
      window.events.onReviewStateChanged((r) => {
        if (r.projectId === data.projectId && r.branch === data.branch) setState(r);
      }),
    [data.projectId, data.branch]
  );
  const outside = data.steps.filter((s) => s.outsideTask);
  const [drop, setDrop] = useState<Set<string>>(() => new Set(defaultDrops(data.steps, state.settled)));
  // What goes with your review. The list below shows what you left out too.
  const comments = sendableComments(state.comments);
  // Each question and decision counts, as they're listed: they can go or stay on their own.
  const commentCount = comments.reduce((n, c) => n + commentParts(c.body).length, 0);
  const written = state.comments.filter((c) => c.body.trim());
  const leftOut = written.reduce((n, c) => n + commentParts(c.body).filter((p) => c.leftOut?.includes(p)).length, 0);
  // Resuming a local session needs the project's own CLI; sending a Copilot coding-agent PR back is a
  // GitHub comment, so it's offered whatever the project's assistant is set to.
  const prCopilot = data.agent === 'copilot' && !data.session;
  const localAgent = !data.assistant || !data.session ? null : data.session.agent === 'copilot' ? 'copilot' : 'claude';
  const agent = prCopilot ? 'copilot' : localAgent;
  const open = openItems(buildPlan(data, state), state);
  const [pick, setPick] = useState<Decision>(() => (agent && (comments.length || drop.size) ? 'send-back' : data.pr ? 'github' : agent ? 'send-back' : 'merge'));
  const [event, setEvent] = useState<GitHubEvent>(() => defaultReviewEvent(open, { comments: comments.length, prByYou: !!data.prByYou }));
  // Merging or approving with something still open takes a second click.
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The branch moved on while this page was open: what it says, with the way to go and look.
  const [changed, setChanged] = useState<string | null>(null);
  const [needsCommit, setNeedsCommit] = useState<number | null>(null);
  const [showComments, setShowComments] = useState(written.length <= 3);
  // A local branch on a linked GitHub repo can become a pull request instead of a local merge.
  const canOpenPr = !data.pr && data.local && !!data.repo;
  const [openPr, setOpenPr] = useState(canOpenPr);
  const [prTitle, setPrTitle] = useState(data.title);
  const [draft, setDraft] = useState(false);
  const opening = canOpenPr && openPr && pick === 'merge';
  const [commitMessage, setCommitMessage] = useState(data.title);

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
  const guarded = vouchesForCode(pick, event) && unfinished.length > 0;
  const vouch = pick === 'merge' ? 'Merge' : 'Approve';
  const stepLabel = (key: string) => {
    const s = data.steps.find((x) => x.key === key);
    if (s) return `Step ${s.index + 1} · ${s.files.length === 1 ? s.files[0] : s.title}`;
    // The walkthrough changed since: the step's title as it was when you asked Claude about it, if you did.
    const was = state.exchanges?.find((e) => e.stepKey === key)?.stepTitle;
    return was ? `Step no longer in the walkthrough · ${was}` : 'Step no longer in the walkthrough';
  };
  // Claude changed this step after you wrote the comment: that may have settled it.
  const changedAfter = (c: Comment) => state.exchanges?.some((e) => e.stepKey === c.stepKey && e.kind === 'change' && e.status === 'done' && e.at > c.createdAt);
  const leaveOut = async (c: Comment, part: string, on: boolean) => {
    try {
      setState(await window.api.updateReview(data.projectId, data.branch, { type: 'leave-out', id: c.id, part, on }));
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const options: { id: Decision; title: string; detail: string; submit: string; disabled?: string }[] = [
    {
      id: 'merge',
      title: data.uncommitted ? 'Approve and commit' : data.prByYou ? 'Merge' : 'Approve and merge',
      detail: data.uncommitted
        ? `Commits the changes to ${data.branch} as they are, as one commit. Nothing is pushed. Your comments stay in Hunkdory.`
        : data.prByYou
          ? `Merges your pull request #${data.pr!.number} into ${data.pr!.baseRefName}${comments.length ? `, with your ${plural(commentCount, 'comment')} on it` : ''}. GitHub doesn’t let you approve your own PR.`
          : data.pr
            ? `Approves pull request #${data.pr.number} on GitHub${comments.length ? ` with your ${plural(commentCount, 'comment')}` : ''} and merges it into ${data.pr.baseRefName}.`
            : canOpenPr && openPr
              ? `Pushes ${data.branch} and opens a pull request into ${base}, with your comments in the description. Nothing is merged yet.`
              : `Merge into ${base} as it is. Your comments stay in Hunkdory.`,
      submit: data.uncommitted ? 'Approve & commit' : data.prByYou ? 'Merge' : data.pr ? 'Approve & merge' : canOpenPr && openPr ? 'Approve & open PR' : 'Approve & merge',
      disabled: unpushedWork(data, thisComputer()) ?? undefined,
    },
    ...(data.pr
      ? [
        {
          id: 'github' as const,
          title: `Post your review on PR #${data.pr.number}`,
          detail: `${comments.length ? `Your ${plural(commentCount, 'comment')} ${commentCount === 1 ? 'goes' : 'go'} on GitHub, on the code ${commentCount === 1 ? "it's" : "they're"} about.` : 'Your review goes on GitHub.'} The PR leaves your inbox until it changes.`,
          submit: event === 'APPROVE' ? 'Approve on GitHub' : event === 'REQUEST_CHANGES' ? 'Request changes on GitHub' : 'Post review',
        },
      ]
      : []),
    prCopilot
      ? {
        id: 'send-back' as const,
        title: 'Send back to Copilot',
        detail: `Posts your review on PR #${data.pr!.number} asking @copilot to address it${dropping.length ? `, including dropping ${dropping.map((s) => `step ${s.index + 1}`).join(', ')}` : ''}. Copilot works on GitHub; the PR comes back here when it pushes.`,
        submit: 'Send back to Copilot',
      }
      : {
        id: 'send-back' as const,
        title: 'Send back to the agent',
        detail: `Resumes the agent's session with ${comments.length ? `your ${plural(commentCount, 'comment')}` : 'your note'}${dropping.length ? ` and asks it to drop ${dropping.map((s) => `step ${s.index + 1}`).join(', ')}` : ''}. It runs in the background and can edit files on the branch.`,
        submit: 'Send back',
        disabled: agent ? undefined : !data.assistant ? "This project is set to Manual, so there's no assistant to send it back to." : `No session on ${thisComputer()} worked on this branch, so there is no agent to send it back to.`,
      },
    {
      id: 'discard',
      title: 'Close this review',
      detail: data.local
        ? 'Closes this review. The branch stays unless you delete it below, and the session stays in your history.'
        : data.uncommitted
          ? 'Removes it from your inbox until the changes do. Your edits stay as they are.'
          : 'Removes it from your inbox. Nothing changes in git or on GitHub.',
      submit: data.local && deleteBranch ? 'Delete the branch' : 'Close review',
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
    setChanged(null);
    try {
      const res = await window.api.finish({ projectId: data.projectId, branch: data.branch, kind: pick, note, dropStepKeys: pick === 'send-back' ? [...drop] : [], seen, commitFirst, deleteBranch, event, openPr: opening ? { title: prTitle.trim() || data.title, draft } : undefined, commitMessage: data.uncommitted ? commitMessage : undefined });
      if (res.ok) go({ name: 'done', projectId: data.projectId, branch: data.branch, result: res, stack: data.stack });
      else if (res.changed) {
        setChanged(res.message);
        setConfirming(false);
      } else if (res.needsCommit) setNeedsCommit(res.needsCommit);
      else setError(res.message);
    } catch (e) {
      setError(cleanError(e));
    }
    setBusy(false);
  };

  // 1 to 4 pick an option, ⌘↵ does it, Esc keeps reviewing: the registry's `finish.*` keys.
  const onScreen = useTabActive();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, 'finish.submit')) {
        if (busy || current.disabled) return;
        e.preventDefault();
        void submit(false);
        return;
      }
      if (!isPlainKey(e)) return;
      if (matches(e, 'finish.back')) {
        e.preventDefault();
        go({ name: 'plan', projectId: data.projectId, branch: data.branch });
      } else if (matches(e, 'finish.pick')) {
        const o = options[Number(e.key) - 1];
        if (!o || o.disabled) return;
        e.preventDefault();
        choose(o.id);
      }
    };
    if (onScreen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const choose = (id: Decision) => {
    setPick(id);
    setNeedsCommit(null);
    setError(null);
    setChanged(null);
    setConfirming(false);
  };

  const noteField = (label: string, placeholder = 'Anything else it should know') => (
    <label className="flex flex-col gap-1 text-ui font-semibold">
      {label}
      <textarea rows={2} className={`${TEXTAREA} font-normal`} placeholder={placeholder} value={note} onChange={(e) => setNote(e.target.value)} />
    </label>
  );

  const optionBody = (id: Decision) => {
    if (id === 'merge' && data.uncommitted)
      return <input className={FIELD} aria-label="Commit message" placeholder="Commit message" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} />;
    if (id === 'merge' && canOpenPr)
      return (
        <>
          <Checkbox checked={openPr} onChange={setOpenPr}>
            Open a pull request instead of merging here
          </Checkbox>
          <span className="pl-6 text-meta text-muted">
            Creates a PR from {data.branch} into {base} on GitHub, with your comments in the description.
          </span>
          {openPr && (
            <div className="flex flex-wrap items-center gap-2.5 pl-6">
              <input className={`${FIELD} min-w-0 flex-[1_1_320px]`} aria-label="Pull request title" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} />
              <Checkbox checked={draft} onChange={setDraft}>
                Open as draft
              </Checkbox>
            </div>
          )}
        </>
      );
    if (id === 'github')
      return (
        <>
          <RadioGroup label="Review type" className="flex flex-wrap gap-4 text-ui">
            {EVENTS.map((e) => (
              <Radio
                key={e.id}
                checked={event === e.id}
                tabbable={event === e.id}
                disabled={e.id === 'APPROVE' && data.prByYou}
                onSelect={() => {
                  setEvent(e.id);
                  setConfirming(false);
                }}
              >
                {e.title}
              </Radio>
            ))}
          </RadioGroup>
          {data.prByYou && <span className="text-meta text-muted">GitHub doesn’t let you approve your own PR.</span>}
          {event === 'REQUEST_CHANGES'
            ? noteField(comments.length ? 'Review summary (optional)' : 'Review summary', 'What needs to change')
            : noteField('Review summary (optional)', comments.length ? 'Anything else it should know' : `Leave it empty to post “${reviewedNote(data.githubLogin)}”`)}
        </>
      );
    if (id === 'send-back') {
      // With no comments and nothing to drop, the note is all the agent gets: sending it back needs one.
      const optional = comments.length > 0 || drop.size > 0;
      return (
        <>
          {outside.map((s) => (
            <Checkbox
              key={s.key}
              checked={drop.has(s.key)}
              onChange={(on) => {
                const next = new Set(drop);
                if (on) next.add(s.key);
                else next.delete(s.key);
                setDrop(next);
              }}
            >
              Drop step {s.index + 1} ({s.title}): you didn’t ask for it
            </Checkbox>
          ))}
          {noteField(`Note to ${agent === 'copilot' ? 'Copilot' : 'the agent'}${optional ? ' (optional)' : ''}`, optional ? undefined : 'What should it change?')}
        </>
      );
    }
    if (id === 'discard' && data.local)
      return (
        <Checkbox
          checked={deleteBranch}
          onChange={(on) => {
            setDeleteBranch(on);
            setConfirming(false);
          }}
        >
          Also delete the branch, and its separate folder if it has one
        </Checkbox>
      );
    return null;
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[...reviewCrumbs(go, data), { label: data.title, onClick: () => go({ name: 'plan', projectId: data.projectId, branch: data.branch }), shrink: true }, { label: 'Finish' }]} />
        </div>
        <RunningWork data={data} state={state} onOpen={() => go({ name: 'plan', projectId: data.projectId, branch: data.branch })} />
        <PrLink data={data} />
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 pt-7 pb-14">
          <div className="flex flex-col gap-1">
            <h1 className="text-hero font-semibold break-words">{data.title}</h1>
            <p className="text-meta text-faint">
              {[`${reviewed} of ${plural(data.steps.length, 'step')} reviewed`, plural(commentCount, 'comment'), dropping.length ? `${plural(dropping.length, 'step')} to drop` : null, minutes ? plural(minutes, 'minute') : null].filter(Boolean).join(' · ')}
            </p>
          </div>

          {/* The decision first: it's what this page is for. Each option holds its own settings. */}
          <section className="flex flex-col gap-2">
            <SectionHeader as="h2">What do you want to do?</SectionHeader>
            <RadioGroup label="What do you want to do?" className="flex flex-col gap-2">
              {options.map((o, i) => {
                const on = pick === o.id;
                const body = on && !o.disabled ? optionBody(o.id) : null;
                return (
                  <div key={o.id} className={`flex flex-col gap-2.5 rounded-xl border p-3.5 ${on ? 'border-edge bg-card shadow-[inset_3px_0_0_var(--sb-text)]' : 'border-border'}`}>
                    <div className="flex items-start gap-3">
                      <Radio checked={on} tabbable={on} disabled={!!o.disabled} describedBy={o.disabled ? `finish-why-${o.id}` : undefined} onSelect={() => choose(o.id)} className="flex-1">
                        <span className="flex flex-col gap-0.5">
                          <span className="text-body font-semibold">{o.title}</span>
                          {!o.disabled && <span className="text-ui text-muted">{o.detail}</span>}
                        </span>
                      </Radio>
                      <Kbd keys={String(i + 1)} className={o.disabled ? 'opacity-50' : ''} />
                    </div>
                    {/* Why it's off stays at full strength, outside the dimmed radio: it's what tells you what to do. */}
                    {o.disabled && (
                      <p id={`finish-why-${o.id}`} className="-mt-2 pl-[22px] text-ui text-muted">
                        {o.disabled}
                      </p>
                    )}
                    {body && <div className="flex flex-col gap-2.5 pl-6">{body}</div>}
                  </div>
                );
              })}
            </RadioGroup>
          </section>

          <section className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-body font-semibold">
                {comments.length ? `Your ${plural(commentCount, 'comment')}` : written.length ? 'No comments go with your review' : 'No comments'}
                {leftOut > 0 && <span className="font-normal text-muted"> · {leftOut} left out</span>}
              </span>
              {written.length > 0 && (
                <Button variant="quiet" size="sm" aria-expanded={showComments} onClick={() => setShowComments(!showComments)}>
                  {showComments ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
            {showComments &&
              written.map((c) => (
                <div key={c.id} className="flex flex-col gap-1.5 rounded-lg bg-code px-3 py-2.5">
                  <span className="min-w-0 text-meta break-words text-faint">
                    {stepLabel(c.stepKey)}
                    {c.path && c.line ? <span className="font-mono"> · {c.path}:{c.line}</span> : null}
                  </span>
                  {commentParts(c.body).map((part) => {
                    const out = !!c.leftOut?.includes(part);
                    return (
                      <div key={part} className="flex items-start justify-between gap-3">
                        <div className={`min-w-0 flex-1 text-body break-words select-text ${out ? 'text-faint' : ''}`}>
                          <Markdown text={part} />
                        </div>
                        <Button variant="quiet" size="sm" disabled={busy} className="shrink-0" data-tooltip={out ? undefined : 'It stays here and doesn’t go with your review.'} onClick={() => leaveOut(c, part, !out)}>
                          {out ? 'Put back' : 'Leave out'}
                        </Button>
                      </div>
                    );
                  })}
                  {changedAfter(c) && <span className="text-meta text-muted">You had the assistant change this step after writing this. If that settled it, leave it out so it doesn’t go with your review.</span>}
                </div>
              ))}
          </section>

          {needsCommit !== null && (
            <Notice
              tone="caution"
              role="alert"
              actions={
                <Button variant="primary" disabled={busy} onClick={() => submit(true)}>
                  Commit {plural(needsCommit, 'file')} and {opening ? 'open the PR' : 'merge'}
                </Button>
              }
            >
              <strong className="font-semibold">
                {plural(needsCommit, 'file')} on this branch {needsCommit === 1 ? "isn't" : "aren't"} committed yet.
              </strong>{' '}
              {opening ? 'A pull request' : 'A merge'} only takes commits. Hunkdory can commit them for you first, with "{data.title}" as the message. Hunkdory's own review files stay out of the commit.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {changed && (
            <Notice
              tone="caution"
              role="alert"
              actions={
                <Button variant="primary" onClick={() => go({ name: 'plan', projectId: data.projectId, branch: data.branch })}>
                  See what's new
                </Button>
              }
            >
              {changed}
            </Notice>
          )}

          {/* What's still open sits next to the button it holds back. */}
          {(guarded || (confirming && risky)) && (
            <Notice tone={confirming ? 'warn' : 'caution'} role={confirming ? 'alert' : 'note'}>
              {guarded ? (
                <>
                  <strong className="font-semibold">{confirming ? `${vouch} with these still open?` : 'Not done yet'}</strong>
                  <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4">
                    {unfinished.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <strong className="font-semibold">Delete {data.branch}{data.dirtyFiles ? ` and its ${plural(data.dirtyFiles, 'uncommitted file')}` : ''}?</strong> Commits on it that aren't merged into {base} are lost too, and so is its separate folder if it has one. This can't be undone.
                </>
              )}
            </Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button size="lg" shortcut="finish.back" onClick={() => go({ name: 'plan', projectId: data.projectId, branch: data.branch })}>
              Keep reviewing
            </Button>
            <Button
              variant={confirming && risky ? 'danger' : 'primary'}
              filled={confirming && risky}
              size="lg"
              shortcut="finish.submit"
              disabled={busy || !!current.disabled}
              aria-busy={busy}
              onClick={() => submit(false)}
            >
              {busy ? 'Working…' : confirming && guarded ? `${vouch} anyway` : confirming && risky ? 'Yes, delete it' : current.submit}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
