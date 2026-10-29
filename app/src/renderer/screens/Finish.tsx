import { useEffect, useState } from 'react';
import type { Go } from '../App.tsx';
import { Crumbs, LoadingPage, cleanError, isPlainKey, plural, reviewCrumbs, useAsync } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Checkbox } from '../components/ui/Checkbox.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Radio, RadioGroup } from '../components/ui/Radio.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { FIELD, TEXTAREA } from '../components/ui/field.ts';
import { matches } from '../lib/shortcuts.ts';
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
  if (!loaded.value) return <LoadingPage label="Reading the branch…" detail={branch} />;
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

  // 1 to 4 pick an option, ⌘↵ does it, Esc keeps reviewing: the registry's `finish.*` keys.
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const choose = (id: Decision) => {
    setPick(id);
    setNeedsCommit(null);
    setError(null);
    setConfirming(false);
  };

  const noteField = (label: string) => (
    <label className="flex flex-col gap-1 text-ui font-semibold">
      {label}
      <textarea rows={2} className={`${TEXTAREA} font-normal`} placeholder="Anything else it should know" value={note} onChange={(e) => setNote(e.target.value)} />
    </label>
  );

  const optionBody = (id: Decision) => {
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
              <Radio key={e.id} checked={event === e.id} tabbable={event === e.id} disabled={e.id === 'APPROVE' && data.prByYou} onSelect={() => setEvent(e.id)}>
                {e.title}
              </Radio>
            ))}
          </RadioGroup>
          {data.prByYou && <span className="text-meta text-muted">GitHub doesn’t let you approve your own PR.</span>}
          {noteField('Review summary (optional)')}
        </>
      );
    if (id === 'send-back')
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
          {noteField(`Note to ${agent === 'copilot' ? 'Copilot' : 'the agent'} (optional)`)}
        </>
      );
    if (id === 'discard' && data.local)
      return (
        <Checkbox
          checked={deleteBranch}
          onChange={(on) => {
            setDeleteBranch(on);
            setConfirming(false);
          }}
        >
          Also delete the branch and its worktree
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
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 pt-7 pb-14">
          <div className="flex flex-col gap-1">
            <h1 className="text-hero font-semibold break-words">{data.title}</h1>
            <p className="text-meta text-faint">
              {[`${reviewed} of ${plural(data.steps.length, 'step')} reviewed`, plural(comments.length, 'comment'), dropping.length ? `${plural(dropping.length, 'step')} to drop` : null, minutes ? plural(minutes, 'minute') : null].filter(Boolean).join(' · ')}
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
                  <div key={o.id} className={`flex flex-col gap-2.5 rounded-xl border p-3.5 ${on ? 'border-edge bg-card shadow-[inset_3px_0_0_var(--sb-text)]' : 'border-border'} ${o.disabled ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-3">
                      <Radio checked={on} tabbable={on} disabled={!!o.disabled} onSelect={() => choose(o.id)} className="flex-1">
                        <span className="flex flex-col gap-0.5">
                          <span className="text-body font-semibold">{o.title}</span>
                          <span className="text-ui text-muted">{o.disabled ?? o.detail}</span>
                        </span>
                      </Radio>
                      <Kbd keys={String(i + 1)} />
                    </div>
                    {body && <div className="flex flex-col gap-2.5 pl-6">{body}</div>}
                  </div>
                );
              })}
            </RadioGroup>
          </section>

          <section className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-body font-semibold">{comments.length ? `Your ${plural(comments.length, 'comment')}` : 'No comments'}</span>
              {comments.length > 0 && (
                <Button variant="quiet" size="sm" aria-expanded={showComments} onClick={() => setShowComments(!showComments)}>
                  {showComments ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
            {showComments &&
              comments.map((c) => (
                <div key={c.id} className="flex flex-col gap-1 rounded-lg bg-code px-3 py-2.5">
                  <span className="text-meta break-words text-faint">
                    {stepLabel(c.stepKey)}
                    {c.path && c.line ? <span className="font-mono"> · {c.path}:{c.line}</span> : null}
                  </span>
                  <div className="text-body break-words select-text">
                    <Markdown text={c.body} />
                  </div>
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
              {opening ? 'A pull request' : 'A merge'} only takes commits. Hunkdory can commit them for you first, with "{data.title}" as the message. The <span className="font-mono">.review</span> folder stays out of the commit.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          {/* What's still open sits next to the button it holds back. */}
          {(guarded || (confirming && risky)) && (
            <Notice tone={confirming ? 'warn' : 'caution'} role={confirming ? 'alert' : 'note'}>
              {guarded ? (
                <>
                  <strong className="font-semibold">{confirming ? 'Merge with these still open?' : 'Not done yet'}</strong>
                  <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4">
                    {unfinished.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <strong className="font-semibold">Delete {data.branch} and its worktree?</strong> Uncommitted changes in it are lost.
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
              {busy ? 'Working…' : confirming && guarded ? 'Merge anyway' : confirming && risky ? 'Delete and discard' : current.submit}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
