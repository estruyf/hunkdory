import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cleanError } from './ui.tsx';
import { Markdown } from './markdown.tsx';
import { Button } from './ui/Button.tsx';
import { Dialog } from './ui/Dialog.tsx';
import { Notice } from './ui/Notice.tsx';
import type { RunLog } from '../../shared/types.ts';

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
        {log?.entries.map((entry, i) =>
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
        )}
        <div ref={end} />
      </div>
    </Dialog>
  );
}
