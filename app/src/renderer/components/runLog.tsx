import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cleanError } from './ui.tsx';
import { Markdown } from './markdown.tsx';
import { Prompt } from '../screens/Review.tsx';
import { Button } from './ui/Button.tsx';
import { Dialog } from './ui/Dialog.tsx';
import { Notice } from './ui/Notice.tsx';
import { SectionHeader } from './ui/SectionHeader.tsx';
import { timeAgo } from '../../shared/order.ts';
import type { RunLog, RunLogEntry, StepTrace } from '../../shared/types.ts';

/** How often the log is read again while the agent works. */
const POLL_MS = 2000;

/** What the agent you sent a review back to is saying and doing, in words, as it goes. The raw file is a click away. */
export function RunLogDialog({ projectId, branch, onClose }: { projectId: string; branch: string; onClose(): void }) {
  const [log, setLog] = useState<RunLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await window.api.runLog(projectId, branch);
        if (!live) return;
        setLog(next);
        setError(null);
        if (next?.running) timer = setTimeout(read, POLL_MS);
      } catch (e) {
        if (live) setError(cleanError(e));
      }
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, branch]);

  // Stays on the newest line, unless you scrolled up to read.
  useLayoutEffect(() => {
    if (following.current) end.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  return (
    <Dialog
      title="Run log"
      subtitle={<span className="font-mono">{branch}</span>}
      width="lg"
      onClose={onClose}
      onScrollCapture={(e) => {
        const s = e.target as HTMLElement;
        following.current = s.scrollHeight - s.scrollTop - s.clientHeight < 40;
      }}
      footerStart={
        log?.running ? (
          <span className="flex items-center gap-2 text-ui text-muted">
            <span className="working-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            The agent is working
          </span>
        ) : (
          log && <span className="min-w-0 text-ui text-muted">{log.message}</span>
        )
      }
      footer={log && <Button onClick={() => window.api.openSessionFile(log.file)}>Show the file</Button>}
    >
      <div className="flex flex-col gap-2.5 select-text">
        {error && <Notice tone="error">{error}</Notice>}
        {log?.cut && <p className="text-meta text-faint">The start of this long run is left out. The file has all of it.</p>}
        {log?.entries.length === 0 && <p className="text-body text-muted">{log.running ? 'Nothing from the agent yet.' : 'The agent didn’t write anything to this log.'}</p>}
        {log && <LogEntries entries={log.entries} />}
        <div ref={end} />
      </div>
    </Dialog>
  );
}

function LogEntries({ entries }: { entries: RunLogEntry[] }) {
  return entries.map((entry, i) =>
    entry.kind === 'text' ? (
      <div key={i} className="text-body break-words">
        <Markdown text={entry.text} />
      </div>
    ) : entry.kind === 'error' ? (
      <Notice key={i} tone="error">
        {entry.text}
      </Notice>
    ) : (
      <div key={i} className={`font-mono text-meta break-words whitespace-pre-wrap ${entry.kind === 'tool' ? 'text-muted' : 'text-faint'}`}>
        {entry.text}
      </div>
    )
  );
}

/** Where the agent edited a step's files in its sessions: what it was asked, what it said just before, and the edits. */
export function StepTraceDialog({ projectId, branch, title, files, onClose }: { projectId: string; branch: string; title: string; files: string[]; onClose(): void }) {
  const [trace, setTrace] = useState<StepTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.api.stepTrace(projectId, branch, files).then(
      (next) => live && setTrace(next),
      (e) => live && setError(cleanError(e))
    );
    return () => {
      live = false;
    };
  }, [projectId, branch, files.join('\n')]);

  return (
    <Dialog title="How the agent got here" subtitle={title} width="lg" onClose={onClose} footerStart={<span className="min-w-0 text-ui text-muted">Edits made through shell commands don’t show up here.</span>}>
      <div className="flex flex-col gap-5 select-text">
        {error && <Notice tone="error">{error}</Notice>}
        {!trace && !error && <p className="text-body text-muted">Reading the agent’s session…</p>}
        {trace?.probable && <Notice tone="caution">This session is a best guess: the agent doesn’t record which branch it ran on.</Notice>}
        {trace?.turns.length === 0 && <p className="text-body text-muted">The session has no edits to these files on this branch. The agent may have made them through a shell command, or in a session that isn’t on this Mac.</p>}
        {trace?.turns.map((turn, i) => (
          <section key={i} className="flex flex-col gap-2">
            <SectionHeader as="h3">
              {turn.subagent ? 'A subagent’s task' : 'Asked'}
              {turn.at ? ` · ${timeAgo(turn.at)}` : ''}
            </SectionHeader>
            {turn.prompt ? <Prompt text={turn.prompt} clamp={240} /> : <p className="text-body text-muted">The session doesn’t show what prompted this.</p>}
            <LogEntries entries={turn.entries} />
          </section>
        ))}
      </div>
    </Dialog>
  );
}
