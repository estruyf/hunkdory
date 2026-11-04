// What people said on the pull request on GitHub: their reviews, and the threads on lines of the diff.
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { GitHubFeedback, GitHubReview, GitHubThread, ReviewData, Step } from '../../shared/types.ts';
import { timeAgo } from '../../shared/order.ts';
import { openThreads } from '../../shared/threads.ts';
import { Markdown } from './markdown.tsx';
import { cleanError, plural } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';
import { Pill } from './ui/Pill.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { TEXTAREA } from './ui/field.ts';
import { modKey } from '../lib/shortcuts.ts';
import type { PillTone } from './ui/buttonStyles.ts';

const VERDICT: Record<GitHubReview['state'], { label: string; tone: PillTone }> = {
  APPROVED: { label: 'Approved', tone: 'ok' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'caution' },
  COMMENTED: { label: 'Commented', tone: 'link' },
  DISMISSED: { label: 'Dismissed', tone: 'muted' },
};

/** The thread as text for the assistant: where it is, and every comment in it, quoted. */
export function threadText(t: GitHubThread): string {
  const where = t.line ? `${t.path}:${t.line}` : t.path;
  const said = t.comments.map((c) => `@${c.author} wrote:\n${c.body.trim().replace(/^/gm, '> ')}`).join('\n\n');
  return `A review comment on GitHub, on ${where}:\n\n${said}`;
}

/** What a thread opens the Ask box with: a question about it, or a request to address it. */
export const askDraft = (t: GitHubThread, kind: 'question' | 'change') =>
  `${threadText(t)}\n\n${kind === 'question' ? 'Is this right? What would you change, and why?' : 'Address this comment in the code.'}`;

/**
 * One thread from GitHub: the comments, then reply, resolve, and ask the assistant about it or to address it.
 * `onAsk` is left out where there's no step to ask from.
 */
export function GitHubThreadCard({
  data,
  thread: t,
  onFeedback,
  onAsk,
  showPath = false,
}: {
  data: ReviewData;
  thread: GitHubThread;
  onFeedback(f: GitHubFeedback | null): void;
  onAsk?: (kind: 'question' | 'change') => void;
  showPath?: boolean;
}) {
  // A resolved thread is settled: one line until you open it.
  const [open, setOpen] = useState(!t.resolved);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = t.comments[0]!;
  const name = data.assistant?.name ?? 'the assistant';

  const act = async (fn: () => Promise<GitHubFeedback | null>) => {
    setBusy(true);
    setError(null);
    try {
      onFeedback(await fn());
      return true;
    } catch (e) {
      setError(cleanError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!reply.trim()) return;
    if (await act(() => window.api.replyOnGitHub(data.projectId, data.branch, t.id, reply.trim()))) {
      setReply('');
      setReplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-link/30 bg-card px-3 py-2.5 text-body">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-2 text-left text-meta text-muted">
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <MessageSquare size={13} className="shrink-0 text-link" aria-hidden />
        <span className="shrink-0 font-semibold text-text">On GitHub</span>
        {showPath && <span className="min-w-0 truncate font-mono">{t.line ? `${t.path}:${t.line}` : t.path}</span>}
        {!open && <span className="min-w-0 flex-1 truncate">@{first.author}: {first.body.split('\n')[0]}</span>}
        {open && <span className="flex-1" />}
        {t.comments.length > 1 && <span className="shrink-0">{plural(t.comments.length, 'comment')}</span>}
        {t.outdated && <Pill tone="muted">Outdated</Pill>}
        {t.resolved && <Pill tone="ok">Resolved</Pill>}
      </button>
      {open && (
        <>
          {t.comments.map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5">
              <span className="text-meta text-faint">
                <span className="font-semibold text-text">@{c.author}</span> · {timeAgo(c.at)}
              </span>
              <div className="min-w-0 break-words select-text">
                <Markdown text={c.body} />
              </div>
            </div>
          ))}
          {replying && (
            <textarea
              autoFocus
              aria-label="Your reply on GitHub"
              rows={3}
              className={TEXTAREA}
              placeholder="Reply on GitHub"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && modKey(e)) send();
                if (e.key === 'Escape') setReplying(false);
              }}
            />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {replying ? (
              <>
                <Button size="sm" variant="primary" kbd="mod+enter" disabled={!reply.trim() || busy} aria-busy={busy} onClick={send}>
                  {busy ? 'Posting…' : 'Post reply'}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setReplying(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {onAsk && data.ask.question.by && (
                  <Button size="sm" onClick={() => onAsk('question')}>
                    Ask {name} about it
                  </Button>
                )}
                {onAsk && (data.ask.change.by || data.ask.change.checkout) && !t.resolved && (
                  <Button size="sm" onClick={() => onAsk('change')}>
                    Have {name} address it
                  </Button>
                )}
                <Button size="sm" variant="quiet" onClick={() => setReplying(true)}>
                  Reply
                </Button>
                <Button size="sm" variant="quiet" disabled={busy} onClick={() => act(() => window.api.resolveOnGitHub(data.projectId, data.branch, t.id, !t.resolved))}>
                  {t.resolved ? 'Reopen' : 'Resolve'}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => window.api.openExternal(first.url)}>
                  Open on GitHub ↗
                </Button>
              </>
            )}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </>
      )}
    </div>
  );
}

/**
 * The plan's view of the PR on GitHub: who reviewed it and what they said, the threads in this diff with a way to
 * the step and line each is on, and the threads no step shows, on code that changed since or that this diff leaves out.
 */
export function GitHubReviews({
  data,
  feedback,
  inDiff,
  elsewhere,
  onFeedback,
  onOpen,
}: {
  data: ReviewData;
  feedback: GitHubFeedback;
  /** Threads on lines of this diff, with the step each is in: open ones first. */
  inDiff: { thread: GitHubThread; step: Step }[];
  elsewhere: GitHubThread[];
  onFeedback(f: GitHubFeedback | null): void;
  /** Opens the step at the thread's line. */
  onOpen(step: Step, thread: GitHubThread): void;
}) {
  const open = openThreads(feedback.threads).length;
  if (!feedback.reviews.length && !feedback.threads.length) return null;
  return (
    <section className="flex flex-col gap-2.5" aria-label="Reviews on GitHub">
      <SectionHeader as="h2" count={feedback.reviews.length || null} action={feedback.threads.length ? <span className="text-meta text-faint">{open ? plural(open, 'open thread') : 'Every thread resolved'}</span> : undefined}>
        Reviews on GitHub
      </SectionHeader>
      {feedback.reviews.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0">
          {feedback.reviews.map((r) => (
            <li key={r.url} className="flex flex-col gap-1 px-4 py-2.5">
              <span className="flex flex-wrap items-center gap-2 text-meta text-faint">
                <span className="font-semibold text-text">@{r.author}</span>
                <Pill tone={VERDICT[r.state].tone}>{VERDICT[r.state].label}</Pill>
                {timeAgo(r.at)}
                <span className="flex-1" />
                <Button size="sm" variant="quiet" onClick={() => window.api.openExternal(r.url)}>
                  Open on GitHub ↗
                </Button>
              </span>
              {r.body.trim() && (
                <div className="min-w-0 break-words text-body select-text">
                  <Markdown text={r.body} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {inDiff.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0" aria-label="Threads on this diff">
          {inDiff.map(({ thread: t, step }) => {
            const first = t.comments[0]!;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(step, t)} className={`group flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2 text-left hover:bg-border/45 ${t.resolved ? 'text-muted' : ''}`}>
                  <MessageSquare size={13} className={`shrink-0 ${t.resolved ? 'text-faint' : 'text-link'}`} aria-hidden />
                  <span className="min-w-0 flex-[1_1_280px] truncate text-body">
                    <span className="font-semibold">@{first.author}</span>: {first.body.split('\n')[0]}
                  </span>
                  {t.comments.length > 1 && <span className="shrink-0 text-meta text-faint">{plural(t.comments.length - 1, 'reply', 'replies')}</span>}
                  {t.resolved && <Pill tone="ok">Resolved</Pill>}
                  <span className="shrink-0 font-mono text-meta text-faint" data-tooltip={t.path}>
                    {t.path.split('/').pop()}:{t.line}
                  </span>
                  <span className="shrink-0 text-ui text-link group-hover:underline" data-tooltip={`Step ${step.index + 1}: ${step.title}`}>
                    Step {step.index + 1} →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {elsewhere.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-meta text-muted">Not in this diff: on code that changed since, or that this review leaves out.</span>
          {elsewhere.map((t) => (
            <GitHubThreadCard key={t.id} data={data} thread={t} onFeedback={onFeedback} showPath />
          ))}
        </div>
      )}
    </section>
  );
}
