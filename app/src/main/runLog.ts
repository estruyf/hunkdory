// What a sent-back agent run did, read from its log: Claude Code's stream-json or Copilot's JSONL.
import { open } from 'node:fs/promises';
import { describeTool as describeClaudeTool } from './assistants/claude.ts';
import { describeTool as describeCopilotTool } from './assistants/copilot.ts';
import type { RunLog, RunLogEntry } from '../shared/types.ts';

/** How much of a log to read: a long run's tool output can run to many megabytes, and this is read again while it works. */
const TAIL_BYTES = 2 * 1024 * 1024;

type Tool = { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
type LogEvent = {
  type?: string;
  cwd?: string;
  is_error?: boolean;
  subtype?: string;
  result?: string;
  exitCode?: number | null;
  message?: { content?: Tool[] };
  data?: { content?: unknown; toolRequests?: { name?: string; arguments?: Record<string, unknown> }[] };
};

/** The log as what the agent said and did, in order. The tool results and the session's bookkeeping stay out. Pure. */
export function parseRunLog(raw: string, projectPath: string): RunLogEntry[] {
  const entries: RunLogEntry[] = [];
  let cwd = projectPath;
  const say = (text: unknown) => {
    if (typeof text === 'string' && text.trim()) entries.push({ kind: 'text', text: text.trim() });
  };
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    let ev: LogEvent;
    try {
      ev = JSON.parse(text);
    } catch {
      // What the CLI printed itself goes to the same file, often why it stopped. A `{` is an event still being written.
      if (!text.startsWith('{')) entries.push({ kind: 'output', text });
      continue;
    }
    if (ev.type === 'system' && ev.cwd) cwd = ev.cwd;
    else if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text') say(c.text);
        else if (c.type === 'tool_use' && c.name) entries.push({ kind: 'tool', text: describeClaudeTool(c.name, c.input ?? {}, cwd) ?? c.name });
      }
    } else if (ev.type === 'assistant.message') {
      say(ev.data?.content);
      for (const t of ev.data?.toolRequests ?? []) if (t.name) entries.push({ kind: 'tool', text: describeCopilotTool(t.name, t.arguments ?? {}, cwd) ?? t.name });
    } else if (ev.type === 'result') {
      // A good run's result repeats its last message; only a failure has something to add.
      if (ev.is_error) entries.push({ kind: 'error', text: ev.result || ev.subtype || 'The run failed.' });
      else if (ev.exitCode) entries.push({ kind: 'error', text: `The run stopped with exit code ${ev.exitCode}.` });
    }
  }
  return entries;
}

/** The end of the log file as entries. `cut` when the start of a very long one was left out. */
export async function readRunLog(file: string, projectPath: string): Promise<Pick<RunLog, 'entries' | 'cut'>> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(size - start), 0, size - start, start);
    const raw = buffer.toString('utf8', 0, bytesRead);
    // Starting partway through a file means starting partway through a line.
    return { entries: parseRunLog(start ? raw.slice(raw.indexOf('\n') + 1) : raw, projectPath), cut: start > 0 };
  } finally {
    await handle.close();
  }
}
