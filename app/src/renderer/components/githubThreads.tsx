// What people said on the pull request on GitHub: their reviews, and the threads on lines of the diff.
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GitHubFeedback, GitHubReview, GitHubThread, ReviewData, Step } from '../../shared/types.ts';
import { timeAgo } from '../../shared/order.ts';
import { openThreads, placeThreads } from '../../shared/threads.ts';
import { Markdown } from './markdown.tsx';
import { cleanError, plural } from './ui.tsx';
import { Button } from './ui/Button.tsx';
import { Notice } from './ui/Notice.tsx';
import { Pill } from './ui/Pill.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { TextButton } from './ui/TextButton.tsx';
import { TEXTAREA } from './ui/field.ts';
import { modKey } from '../lib/shortcuts.ts';

const VERDICT: Record<GitHubReview['state'], { label: string; text: string }> = {
  APPROVED: { label: 'Approved', text: 'text-ok' },
  CHANGES_REQUESTED: { label: 'Changes requested', text: 'text-caution' },
  COMMENTED: { label: 'Commented', text: 'text-muted' },
  DISMISSED: { label: 'Dismissed', text: 'text-faint' },
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
                <Markdown text={c.body} path={t.path} />
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

/** A review's first lines as plain text: the page shows two of them, so the markup would only get in the way. */
const plainText = (md: string) => md.replace(/\*\*|__|`/g, '').replace(/^[#>\s]+/gm, '').trim();

/**
 * "What reviewers said": who reviewed the PR and what they wrote, which steps have open threads, and the open threads
 * no step shows, on code that changed since or that this diff leaves out. The threads on lines also show in their steps.
 */
export function ReviewersSaid({
  data,
  feedback,
  onFeedback,
  onOpen,
}: {
  data: ReviewData;
  feedback: GitHubFeedback;
  onFeedback(f: GitHubFeedback | null): void;
  /** Opens the step at the thread's line. */
  onOpen(step: Step, thread: GitHubThread): void;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  const placed = useMemo(() => placeThreads(openThreads(feedback.threads), data.hunks), [feedback, data.hunks]);
  const byStep = data.steps.flatMap((step) => {
    const threads = step.hunkIds.flatMap((id) => placed.byHunk.get(id) ?? []);
    return threads.length ? [{ step, threads }] : [];
  });
  return (
    <>
      {feedback.reviews.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0 text-body" aria-label="Reviews on GitHub">
          {feedback.reviews.map((r) => (
            <li key={r.url} className="grid grid-cols-[132px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 border-t border-border py-2.5">
              <span className={`text-meta font-semibold ${VERDICT[r.state].text}`}>{VERDICT[r.state].label}</span>
              <span className="flex min-w-0 flex-col">
                <span>
                  <strong className="font-semibold">@{r.author}</strong> <span className="text-ui text-faint">· {timeAgo(r.at)} ·</span>{' '}
                  <TextButton className="text-ui" onClick={() => window.api.openExternal(r.url)}>
                    Open on GitHub ↗
                  </TextButton>
                </span>
                {r.body.trim() && <span className="line-clamp-2 text-ui break-words whitespace-pre-line text-muted select-text">{plainText(r.body)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {byStep.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <SectionHeader as="h2">Open threads, by step</SectionHeader>
          <ul className="m-0 flex list-none flex-col p-0 text-body">
            {byStep.map(({ step, threads }) => (
              <li key={step.key} className="border-t border-border">
                <button type="button" onClick={() => onOpen(step, threads[0]!)} className="group flex w-full items-baseline gap-3 py-1.5 text-left">
                  <span className="min-w-0 flex-1 break-words">
                    Step {step.index + 1} · {step.title}
                  </span>
                  <span className="shrink-0 text-ui text-link group-hover:underline">{plural(threads.length, 'thread')} →</span>
                </button>
              </li>
            ))}
          </ul>
          <span className="text-meta text-faint">They also show at their lines when you get there, and you can reply from the step.</span>
        </section>
      )}
      {placed.elsewhere.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <SectionHeader as="h2">Not on a line in this review</SectionHeader>
          <ul className="m-0 flex list-none flex-col p-0 text-body">
            {placed.elsewhere.map((t) => {
              const first = t.comments[0]!;
              return (
                <li key={t.id} className="flex flex-col gap-2 border-t border-border py-1.5">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="min-w-0 flex-[1_1_300px] break-words">
                      <strong className="font-semibold">@{first.author}</strong>{' '}
                      <span className="text-muted">
                        {t.outdated ? 'on an older commit' : <>on <span className="font-mono text-ui">{t.path.split('/').pop()}</span></>}: {first.body.split('\n')[0]}
                      </span>
                    </span>
                    <TextButton className="text-ui" aria-expanded={replying === t.id} onClick={() => setReplying(replying === t.id ? null : t.id)}>
                      {replying === t.id ? 'Close' : t.comments.length > 1 ? `Read ${plural(t.comments.length - 1, 'reply', 'replies')} or reply` : 'Reply'}
                    </TextButton>
                    <TextButton className="text-ui" onClick={() => window.api.openExternal(first.url)}>
                      Open on GitHub ↗
                    </TextButton>
                  </span>
                  {replying === t.id && <GitHubThreadCard data={data} thread={t} onFeedback={onFeedback} showPath />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
