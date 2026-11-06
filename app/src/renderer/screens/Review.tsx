import { useEffect, useMemo, useRef, useState } from 'react';
import type { Go } from '../App.tsx';
import { useAsync } from '../components/ui.tsx';
import { LoadingPage } from '../components/LoadingPage.tsx';
import { readReview } from '../state/reviewReads.ts';
import { ViewHeader } from '../components/ViewHeader.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { SectionHeader } from '../components/ui/SectionHeader.tsx';
import { TextButton } from '../components/ui/TextButton.tsx';
import { TEXTAREA } from '../components/ui/field.ts';
import type { AgentChoice, IssueRef, ReviewData, ReviewState, Step } from '../../shared/types.ts';
import { ExternalLink, IssueRefsContext, Markdown } from '../components/markdown.tsx';
import { timeAgo } from '../../shared/order.ts';
import { promptPreview } from '../../shared/promptText.ts';
import { Walkthrough } from './Walkthrough.tsx';
import type { LineRef } from '../components/diff.tsx';

type At = { stepKey?: string; decision?: string; group?: string; focus?: LineRef };

export function Review({ go, projectId, branch, stepKey, decision, group, story, focus, preloaded }: { story?: boolean; go: Go; projectId: string; branch: string; preloaded?: { data: ReviewData; state: ReviewState } } & At) {
  // Read once per branch. Moving between steps changes the route, not the review.
  const loaded = useAsync(() => (preloaded ? Promise.resolve(preloaded) : readReview(projectId, branch)), [projectId, branch]);
  const value = loaded.value ?? preloaded;
  if (loaded.error) return <ReviewError go={go} message={loaded.error} />;
  if (!value) return <LoadingPage shape="step" projectId={projectId} branch={branch} />;
  return (
    <IssueRefsContext.Provider value={value.data.references}>
      <Walkthrough go={go} data={value.data} initialState={value.state} stepKey={stepKey} decision={decision} group={group} story={story} focus={focus} />
    </IssueRefsContext.Provider>
  );
}

export function ReviewError({ go, message }: { go: Go; message: string }) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader>
        <h1 className="text-title font-semibold">Can't open this review</h1>
      </ViewHeader>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
        <Notice tone="error">{message}</Notice>
        <div>
          <Button onClick={() => go({ name: 'home' })}>Back to the inbox</Button>
        </div>
      </div>
    </div>
  );
}

/** The prompt when a session made the branch, else the PR description, else a plain note. */
export function AskedFor({ data, clamp, plain }: { data: ReviewData; clamp?: number; plain?: boolean }) {
  if (data.prompt) return <Prompt text={data.prompt} clamp={clamp} plain={plain} />;
  if (data.pr?.body.trim()) return <Prompt text={data.pr.body.trim()} clamp={clamp} plain={plain} />;
  return (
    <p className="text-body text-muted">
      {data.pr ? 'The pull request has no description, and no agent session on this Mac worked on its branch.' : 'No agent session ran on this branch, so there is no prompt to show.'}
    </p>
  );
}

const linkedIssues = (data: ReviewData) => data.references?.refs.filter((r) => r.kind === 'issue') ?? [];
export const hasLinkedIssues = (data: ReviewData) => linkedIssues(data).length > 0;

/** The issues the PR points at: what the work is about, in the words of whoever reported it. PRs are left out: the stack shows those. */
export function LinkedIssues({ data, clamp, plain }: { data: ReviewData; clamp?: number; plain?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {linkedIssues(data).map((issue) => (
        <LinkedIssue key={issue.number} issue={issue} clamp={clamp} plain={plain} />
      ))}
    </div>
  );
}

/** The issue a PR fixes opens with its text; one it only mentions stays a title until you ask. */
function LinkedIssue({ issue, clamp, plain }: { issue: IssueRef; clamp?: number; plain?: boolean }) {
  const [open, setOpen] = useState(issue.closes);
  const body = issue.body.trim();
  return (
    <div className="flex flex-col gap-1 text-ui">
      <button type="button" className="text-left break-words text-link hover:underline" onClick={() => window.api.openExternal(issue.url)}>
        #{issue.number} {issue.title} ↗
      </button>
      {(issue.closes || issue.state !== 'open') && <span className="text-meta text-muted">{[issue.closes && 'This PR says it fixes this', issue.state !== 'open' && 'Closed'].filter(Boolean).join(' · ')}</span>}
      {body && open && <Prompt text={body} clamp={clamp} plain={plain} />}
      {body && !open && (
        <button type="button" className="self-start text-link hover:underline" onClick={() => setOpen(true)}>
          Show what it says
        </button>
      )}
    </div>
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

export const NO_TEST_HINT = 'No test file changed in this step. Tests that already exist may still cover this code.';

/** What could break in a step, in the walkthrough's words. */
export function RiskNote({ text }: { text: string }) {
  return (
    <Notice tone="caution" role="note">
      <strong className="font-semibold">What could break</strong>
      <div className="break-words select-text">
        <Markdown text={text} />
      </div>
    </Notice>
  );
}

/** What the agent decided in a step and what it set aside, marked with whose account it is. */
export function AgentChoices({ choices, by }: { choices: AgentChoice[]; by: ReviewData['walkthrough'] }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
      <SectionHeader as="h2" count={choices.length}>
        {choices.length === 1 ? 'A choice the agent made' : 'Choices the agent made'}
      </SectionHeader>
      {choices.map((c, i) => (
        <div key={i} className="flex flex-col gap-0.5 text-body break-words select-text">
          <strong className="font-semibold">
            <Markdown text={c.question} />
          </strong>
          <Markdown text={c.chose} />
          {c.why && (
            <div className="text-ui text-muted">
              <Markdown text={c.why} />
            </div>
          )}
          {c.rejected.length > 0 && (
            <div className="text-ui text-muted">
              <Markdown text={`Set aside: ${c.rejected.join('; ')}`} />
            </div>
          )}
        </div>
      ))}
      <span className="text-meta text-faint">{by === 'reviewer' ? 'Hunkdory’s reading of the agent’s session, not checked against the code.' : 'The agent’s own account, not checked against the code.'}</span>
    </section>
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

/** A prompt without a box of its own, for a section that's plain too: a preview in plain text, then all of it, with long links shortened. */
function PlainPrompt({ text, clamp }: { text: string; clamp: number }) {
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => promptPreview(text, clamp), [text, clamp]);
  if (!preview.cut || open) {
    return (
      <div className="text-body break-words select-text">
        <Markdown text={text} shortLinks />
        {preview.cut && (
          <TextButton className="mt-1 block text-ui" onClick={() => setOpen(false)}>
            Show less
          </TextButton>
        )}
      </div>
    );
  }
  return (
    <p className="m-0 text-body break-words whitespace-pre-line select-text">
      {preview.parts.map((part, i) =>
        'url' in part ? (
          <ExternalLink key={i} href={part.url} title={part.url} className="text-link [overflow-wrap:anywhere] hover:underline">
            {part.label}
          </ExternalLink>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}{' '}
      <TextButton onClick={() => setOpen(true)}>Show all</TextButton>
    </p>
  );
}

export function Prompt({ text, clamp = 600, plain = false }: { text: string; clamp?: number; plain?: boolean }) {
  const [open, setOpen] = useState(false);
  if (plain) return <PlainPrompt text={text} clamp={clamp} />;
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
