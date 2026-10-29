import { useEffect, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { LoadingPage, useAsync } from '../components/ui.tsx';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { TEXTAREA } from '../components/ui/field.ts';
import type { ReviewData, ReviewState, Step } from '../../shared/types.ts';
import { Markdown } from '../components/markdown.tsx';
import { timeAgo } from '../../shared/order.ts';
import { Walkthrough } from './Walkthrough.tsx';

type At = { stepKey?: string; decision?: string; group?: string };

export function Review({ go, projectId, branch, stepKey, decision, group, preloaded }: { go: Go; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } } & At) {
  // Read once per branch. Moving between steps changes the route, not the review.
  const loaded = useAsync(() => (preloaded ? Promise.resolve(preloaded) : window.api.loadReview(projectId, branch)), [projectId, branch]);
  const value = loaded.value ?? preloaded;
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!value) return <LoadingPage onHome={() => go({ name: 'home' })} label="Reading the branch…" detail={branch} />;
  return <Walkthrough go={go} data={value.data} initialState={value.state} stepKey={stepKey} decision={decision} group={group} />;
}

export function ReviewError({ go, message }: { go: Go; message: string }) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <h1 className="text-title font-semibold">Can't open this review</h1>
      </ViewHeader>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
        <Notice tone="error">{message}</Notice>
        <div>
          <Button onClick={() => go({ name: 'home' })}>Back to the inbox</Button>
        </div>
      </div>
    </div>
  );
}

/** The prompt when a session made the branch, else the PR description, else a plain note. */
export function AskedFor({ data, clamp }: { data: ReviewData; clamp?: number }) {
  if (data.prompt) return <Prompt text={data.prompt} clamp={clamp} />;
  if (data.pr?.body.trim()) return <Prompt text={data.pr.body.trim()} clamp={clamp} />;
  return (
    <p className="text-body text-muted">
      {data.pr ? 'The pull request has no description, and no Claude Code session on this Mac worked on its branch.' : 'No Claude Code session ran on this branch, so there is no prompt to show.'}
    </p>
  );
}

/** Whether the agent ran tests in its session, and whether that still covers the last edit. */
export function AgentTests({ data }: { data: ReviewData }) {
  const t = data.agentTests;
  if (!t) return null;
  const last = t.runs.at(-1);
  if (!last) return <span className="font-semibold text-caution">The agent didn’t run any tests in its session.</span>;
  const outcome = { passed: 'they passed', failed: 'they failed', unknown: 'the output doesn’t say if they passed' }[last.result];
  const stale = !!t.lastEditAt && t.lastEditAt > last.at;
  return (
    <span>
      <span className={`font-semibold ${last.result === 'passed' && !stale ? 'text-ok' : last.result === 'failed' ? 'text-error' : 'text-caution'}`}>
        Last run {timeAgo(last.at)}: {outcome}.
      </span>{' '}
      <span className="font-mono text-meta break-all text-muted">{last.command}</span>
      {stale && <> The agent edited files after that run.</>}
      {t.runs.length > 1 && <span className="text-muted"> ({t.runs.length} runs in all)</span>}
    </span>
  );
}

export function whyFallback(step: Step, data: ReviewData) {
  if (step.source === 'skeleton') return 'No walkthrough on this branch, so there is no explanation. This step shows every change to this file.';
  if (data.walkthrough === 'agent') return 'The agent didn’t explain this step.';
  if (data.walkthrough === 'reviewer') return 'Hunkdory’s walkthrough has no explanation for this step.';
  return '';
}

export function CommentBox({ initial, onSave, children }: { initial: string; onSave: (body: string) => void; children?: React.ReactNode }) {
  const [body, setBody] = useState(initial);
  const latest = useRef({ body, onSave });
  latest.current = { body, onSave };
  const saved = useRef(initial);
  const save = () => {
    const { body, onSave } = latest.current;
    if (body.trim() === saved.current.trim()) return;
    saved.current = body;
    onSave(body);
  };
  // Save shortly after typing stops, and when leaving the step.
  useEffect(() => {
    const t = setTimeout(save, 800);
    return () => clearTimeout(t);
  }, [body]);
  useEffect(() => save, []);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <label htmlFor="feedback" className="text-ui font-semibold">
        Comment on this step
      </label>
      <textarea
        id="feedback"
        rows={3}
        className={TEXTAREA}
        placeholder="e.g. Use the existing cache helper instead of adding a dependency"
        value={body}
        onChange={(e) => {
          // Also record it synchronously: if the step changes before React renders this update, the unmount save still sees it.
          latest.current.body = e.target.value;
          setBody(e.target.value);
        }}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
      />
      <span className="text-meta text-faint">Saved as you type. It goes with your review when you finish.</span>
      {children && <div className="flex flex-wrap items-center justify-between gap-2.5">{children}</div>}
    </section>
  );
}

export function Prompt({ text, clamp = 600 }: { text: string; clamp?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > clamp;
  // Cut by height, not characters: slicing markdown can break a table or code block halfway.
  const collapsed = long && !open;
  return (
    <div className="rounded-lg bg-code px-3 py-2 text-body break-words select-text">
      <div className={collapsed ? 'fade-out overflow-hidden' : undefined} style={collapsed ? { maxHeight: `${Math.round(clamp / 45)}em` } : undefined}>
        <Markdown text={text} />
      </div>
      {long && (
        <button type="button" className="mt-1 block text-ui text-link hover:underline" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}
