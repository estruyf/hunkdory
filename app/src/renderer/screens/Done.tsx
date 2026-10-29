import type { Go } from '../App.tsx';
import { useEffect } from 'react';
import { Crumbs, plural, rememberReview, useInbox } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Kbd } from '../components/ui/Kbd.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { matches } from '../lib/shortcuts.ts';
import { formatDuration, suggestedOrder } from '../../shared/order.ts';
import type { FinishResult } from '../../shared/types.ts';

const HEADINGS = { merge: 'Merged', 'send-back': 'Sent back to Claude Code', discard: 'Discarded', github: 'Review posted on GitHub' } as const;

export function Done({ go, projectId, branch, result }: { go: Go; projectId: string; branch: string; result: FinishResult }) {
  const inbox = useInbox();
  const decision = result.review?.decision;
  useEffect(() => {
    if (result.review) rememberReview(result.review);
  }, []);
  const kind = decision?.kind ?? 'merge';
  const queue = suggestedOrder(inbox.value?.waiting.filter((w) => !(w.projectId === projectId && w.branch === branch) && w.review?.status !== 'sent-back' && !w.ignored && !w.error) ?? []);
  const next = queue[0];
  const queueMinutes = queue.reduce((n, w) => n + w.minutes, 0);

  const heading = kind === 'send-back' && decision?.github ? 'Sent back to Copilot' : HEADINGS[kind];

  // ⌘↵ reviews the next branch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!next || !matches(e, 'done.next')) return;
      e.preventDefault();
      go({ name: 'plan', projectId: next.projectId, branch: next.branch });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <div className="min-w-0 flex-1">
          <Crumbs items={[{ label: heading }]} />
        </div>
      </ViewHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-14 pb-14">
          <OutcomeIcon kind={kind} />
          <div className="flex flex-col gap-2">
            <h1 className="text-hero font-semibold">{heading}</h1>
            <p className="text-body text-muted select-text">
              {kind === 'send-back' && !decision?.github
                ? `The session picked up your ${decision?.dropStepKeys.length ? 'comments and the steps to drop' : 'comments'}. It works in the background; the branch shows up under To review again when it's done, and you review what changed.`
                : result.message}
            </p>
          </div>

          {decision?.github?.url && (
            <div>
              <Button onClick={() => window.api.openExternal(decision.github!.url!)}>Open the review on GitHub ↗</Button>
            </div>
          )}

          {kind === 'send-back' && !decision?.github && (
            <Notice
              tone="neutral"
              icon={
                <span className="working-dots mt-1.5" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              }
              actions={
                decision?.logFile ? (
                  <Button size="sm" onClick={() => window.api.openSessionFile(decision.logFile!)}>
                    Show the run log
                  </Button>
                ) : undefined
              }
            >
              <strong className="font-semibold text-text">The agent is working</strong> <span className="font-mono">{branch}</span> · started just now
            </Notice>
          )}

          {next && (
            <section className="flex flex-col gap-2">
              <SectionHeader as="h2" count={queue.length}>
                Next up
              </SectionHeader>
              <button
                type="button"
                onClick={() => go({ name: 'plan', projectId: next.projectId, branch: next.branch })}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-border/45"
              >
                <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                  <span className="text-body font-semibold">{next.title}</span>
                  <span className="text-meta text-faint">
                    {next.projectName} · {plural(next.steps, 'step')} · about {formatDuration(next.minutes)}
                    {queue.length > 1 ? ` · ${queue.length} waiting, about ${formatDuration(queueMinutes)} in all` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-ui font-semibold text-text">
                  Review now <Kbd shortcut="done.next" />
                </span>
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
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
