import type { Go } from '../App.tsx';
import { useEffect, useState } from 'react';
import { cleanError, Crumbs, plural, rememberReview, useInbox } from '../components/ui.tsx';
import { nextInStack, openStackEntry, stackProgress, stackStatus } from '../components/github.tsx';
import { RunLogDialog } from '../components/runLog.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Confetti } from '../components/Confetti.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { Pill } from '../components/ui/Pill.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { matches } from '../lib/shortcuts.ts';
import { useTabActive } from '../state/tabPane.ts';
import { formatDuration, suggestedOrder } from '../../shared/order.ts';
import type { FinishResult, InboxItem, ReviewData, StackEntry } from '../../shared/types.ts';

const HEADINGS = { merge: 'Merged', 'send-back': 'Sent back to the agent', discard: 'Review closed', github: 'Review posted on GitHub' } as const;

export function Done({ go, projectId, branch, result, stack }: { go: Go; projectId: string; branch: string; result: FinishResult; stack: ReviewData['stack'] }) {
  const inbox = useInbox();
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  // How a send-back is going changes while you're here.
  const [decision, setDecision] = useState(result.review?.decision);
  useEffect(() => {
    if (result.review) rememberReview(result.review);
    return window.events.onReviewStateChanged((r) => {
      if (r.projectId === projectId && r.branch === branch && r.decision) setDecision(r.decision);
    });
  }, []);
  const kind = decision?.kind ?? 'merge';
  // A stacked PR: the one you just finished counts as done, and the next one up the stack comes before the inbox.
  const prs = stack?.prs.map((e) => (e.current ? { ...e, status: result.review?.status ?? e.status, changed: false } : e)) ?? [];
  const stackNext = nextInStack(prs);
  const queue = suggestedOrder(inbox.value?.waiting.filter((w) => !(w.projectId === projectId && w.branch === branch) && w.review?.status !== 'sent-back' && !w.ignored && !w.error && !(stackNext && w.projectId === projectId && w.branch === stackNext.branch)) ?? []);
  const next = queue[0];
  const queueMinutes = queue.reduce((n, w) => n + w.minutes, 0);
  const waitingFor = (e: StackEntry) => inbox.value?.waiting.find((w) => w.projectId === projectId && w.branch === e.branch);
  const openNext = () => {
    if (stackNext) openStackEntry(projectId, stackNext, go).catch((e) => setError(cleanError(e)));
    else if (next) go({ name: 'plan', projectId: next.projectId, branch: next.branch });
  };

  const heading = kind === 'send-back' && decision?.github ? 'Sent back to Copilot' : decision?.commit ? 'Committed' : HEADINGS[kind];

  // ⌘↵ reviews the next branch.
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (showLog || !(stackNext || next) || !matches(e, 'done.next')) return;
      e.preventDefault();
      openNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Something landed: a merge or a posted review. */}
      {(kind === 'merge' || kind === 'github') && <Confetti />}
      {showLog && <RunLogDialog projectId={projectId} branch={branch} onClose={() => setShowLog(false)} />}
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[{ label: heading }]} />
        </div>
      </ViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-14 pb-14">
          <OutcomeIcon kind={kind} />
          <div className="flex flex-col gap-2">
            <h1 className="text-hero font-semibold">{heading}</h1>
            <p className="text-body text-muted select-text">
              {kind === 'send-back' && !decision?.github
                ? `The session picked up your ${decision?.dropStepKeys.length ? 'comments and the steps to drop' : 'comments'}. It works in the background; the branch shows up under To review again when it's done, and you review what changed.`
                : result.message}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {decision?.github?.url && <Button onClick={() => window.api.openExternal(decision.github!.url!)}>Open the review on GitHub ↗</Button>}
            <Button shortcut="home" onClick={() => go({ name: 'home' })}>
              Back to the inbox
            </Button>
          </div>

          {kind === 'send-back' && !decision?.github && (
            <Notice
              tone={decision?.result === 'failed' ? 'error' : decision?.result === 'ok' ? 'success' : 'neutral'}
              icon={
                decision?.result === 'running' ? (
                  <span className="working-dots mt-1.5" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                ) : undefined
              }
              actions={
                <>
                  {decision?.logFile && (
                    <Button size="sm" onClick={() => setShowLog(true)}>
                      Show the run log
                    </Button>
                  )}
                  {decision?.result === 'running' && (
                    <Button size="sm" onClick={() => window.api.cancelSendBack(projectId, branch)}>
                      Stop
                    </Button>
                  )}
                  {decision?.result === 'ok' && (
                    <Button size="sm" variant="primary" onClick={() => go({ name: 'plan', projectId, branch })}>
                      See what changed
                    </Button>
                  )}
                  {decision?.result === 'failed' && (
                    <Button size="sm" onClick={() => go({ name: 'finish', projectId, branch })}>
                      Send it back again
                    </Button>
                  )}
                </>
              }
            >
              {decision?.result === 'running' ? (
                <>
                  <strong className="font-semibold text-text">The agent is working</strong> <span className="font-mono">{branch}</span>
                </>
              ) : decision?.result === 'ok' ? (
                <>
                  <strong className="font-semibold">The agent is done.</strong> {decision.message}
                </>
              ) : (
                <>
                  <strong className="font-semibold">The agent didn't finish.</strong> {decision?.message}
                </>
              )}
            </Notice>
          )}

          {error && <Notice tone="error">{error}</Notice>}

          {stackNext && (
            <section className="flex flex-col gap-2">
              <SectionHeader as="h2">Next in the stack</SectionHeader>
              <NextCard
                title={stackNext.title}
                meta={[`PR #${stackNext.number}`, `${prs.indexOf(stackNext) + 1} of ${prs.length} in the stack`, ...sizeOf(waitingFor(stackNext))].join(' · ')}
                onClick={openNext}
                shortcut
              />
            </section>
          )}

          {stack && <StackList prs={prs} base={stack.base} onOpen={(e) => openStackEntry(projectId, e, go).catch((err) => setError(cleanError(err)))} />}

          {next && (
            <section className="flex flex-col gap-2">
              <SectionHeader as="h2" count={queue.length}>
                {stackNext ? 'Next in your inbox' : 'Next up'}
              </SectionHeader>
              <NextCard
                title={next.title}
                meta={[next.projectName, ...sizeOf(next), ...(queue.length > 1 ? [`${queue.length} waiting, about ${formatDuration(queueMinutes)} in all`] : [])].join(' · ')}
                onClick={() => go({ name: 'plan', projectId: next.projectId, branch: next.branch })}
                shortcut={!stackNext}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** "1 step · about 1 min", when the inbox has read the branch. */
const sizeOf = (w: InboxItem | undefined) => (w ? [plural(w.steps, 'step'), `about ${formatDuration(w.minutes)}`] : []);

function NextCard({ title, meta, onClick, shortcut }: { title: string; meta: string; onClick(): void; shortcut?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-border/45">
      <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
        <span className="text-body font-semibold">{title}</span>
        <span className="text-meta text-faint">{meta}</span>
      </span>
      <span className="flex items-center gap-2 text-ui font-semibold text-text">
        Review now {shortcut && <Kbd shortcut="done.next" />}
      </span>
    </button>
  );
}

/** Every PR in the stack, bottom first, with where you are with each: the one you just finished included. */
function StackList({ prs, base, onOpen }: { prs: StackEntry[]; base: string; onOpen(e: StackEntry): void }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader as="h2" action={<span className="text-meta text-faint">{stackProgress(prs)}</span>}>
        The stack
      </SectionHeader>
      <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0">
        <li className="px-4 py-2 text-meta text-faint">
          On <span className="font-mono">{base}</span>
        </li>
        {prs.map((e) => {
          const st = stackStatus(e);
          const body = (
            <>
              <span className="w-14 shrink-0 font-mono text-meta text-faint">#{e.number}</span>
              <span className="min-w-0 flex-1 truncate text-body">{e.title}</span>
              {e.current && <span className="shrink-0 text-meta text-faint">Just finished</span>}
              {st ? (
                <Pill tone={st.tone} icon={<st.icon size={12} strokeWidth={2.5} aria-hidden />}>
                  {st.label}
                </Pill>
              ) : <span className="shrink-0 text-meta text-faint">Not reviewed yet</span>}
            </>
          );
          return (
            <li key={e.number}>
              {e.current ? (
                <div aria-current="page" className="flex items-center gap-3 bg-selected px-4 py-2">
                  {body}
                </div>
              ) : (
                <button type="button" onClick={() => onOpen(e)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-border/45">
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One picture per outcome: a tick for a merge, an arrow for work going back, a bin for a discard, a speech bubble for a posted review. */
function OutcomeIcon({ kind }: { kind: keyof typeof HEADINGS }) {
  const look = {
    merge: { tint: 'bg-ok/12 text-ok', d: ['M5 12l5 5 9-10'] },
    'send-back': { tint: 'bg-selected text-text', d: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] },
    discard: { tint: 'bg-selected text-muted', d: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'] },
    github: { tint: 'bg-ok/12 text-ok', d: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  }[kind];
  return (
    <div className={`flex size-12 items-center justify-center rounded-full ${look.tint}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {look.d.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  );
}
