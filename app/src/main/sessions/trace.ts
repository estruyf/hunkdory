// What an agent said and did in its session, for the review: where it edited a step's files, and its own account
// of the work for whoever writes the walkthrough. Tool output stays out: it's the bulk of a transcript and says little here.
import { readFile } from 'node:fs/promises';
import { EDIT_TOOLS as CLAUDE_EDITS, promptText, subagentFiles } from './claude.ts';
import { EDIT_TOOLS as COPILOT_EDITS } from './copilot.ts';
import type { RunLogEntry, SessionInfo, StepTraceTurn } from '../../shared/types.ts';

export type TraceEvent =
  | { kind: 'prompt'; text: string; at: string | null }
  | { kind: 'said' | 'thought'; text: string; at: string | null }
  | { kind: 'edit'; id: string | null; path: string; at: string | null }
  /** The edit with this id didn't go through, so it isn't part of the change. */
  | { kind: 'failed'; id: string };

const parsedLines = <T>(raw: string): T[] =>
  raw.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as T];
    } catch {
      return []; // A transcript being written can end in a partial line.
    }
  });

type ClaudeBlock = { type?: string; text?: unknown; thinking?: unknown; id?: string; name?: string; input?: { file_path?: unknown; notebook_path?: unknown }; tool_use_id?: string; is_error?: boolean };
type ClaudeRec = Parameters<typeof promptText>[0] & { type?: string; isSidechain?: boolean; timestamp?: string; gitBranch?: string; message?: { content?: unknown } };

/** A Claude Code transcript as events. In a subagent's own file every record is a sidechain and its first prompt is its task. */
export function claudeEvents(raw: string, subagent = false): TraceEvent[] {
  return recordEvents(parsedLines<ClaudeRec>(raw), subagent);
}

/** The branch a record ran on. HEAD is only git between branches, as in a rebase. */
const branchOf = (rec: ClaudeRec) => (rec.gitBranch && rec.gitBranch !== 'HEAD' ? rec.gitBranch : null);

/**
 * The events of a session's work on one branch: its time on that branch, and any stretch that led straight into it.
 * Agents often think on the base branch and only make the branch to commit, so that lead-up is where the reasons are.
 */
export function claudeBranchEvents(raw: string, branch: string, leadsUp: (name: string | null) => boolean): TraceEvent[] {
  const stretches: { name: string | null; recs: ClaudeRec[] }[] = [{ name: null, recs: [] }];
  for (const rec of parsedLines<ClaudeRec>(raw)) {
    // A subagent's branch says nothing about the session's.
    if (rec.isSidechain) continue;
    const name = branchOf(rec);
    const last = stretches.at(-1)!;
    if (name && name !== last.name) {
      if (last.name === null && !last.recs.some((r) => r.gitBranch)) last.name = name;
      else stretches.push({ name, recs: [] });
    }
    stretches.at(-1)!.recs.push(rec);
  }
  return recordEvents(stretches.filter((s, i) => s.name === branch || (stretches[i + 1]?.name === branch && leadsUp(s.name))).flatMap((s) => s.recs));
}

/**
 * The same for a subagent's own transcript, which has no stretches to go by because it usually stays on one branch.
 * Each record counts if it ran on the branch or on one that can lead up to it.
 */
export function claudeSubagentEvents(raw: string, branch: string, leadsUp: (name: string | null) => boolean): TraceEvent[] {
  return recordEvents(parsedLines<ClaudeRec>(raw).filter((rec) => branchOf(rec) === branch || leadsUp(branchOf(rec))), true);
}

function recordEvents(recs: ClaudeRec[], subagent = false): TraceEvent[] {
  const out: TraceEvent[] = [];
  for (const rec of recs) {
    if (rec.isSidechain && !subagent) continue;
    const at = rec.timestamp ?? null;
    const prompt = promptText({ ...rec, isSidechain: false });
    if (prompt) out.push({ kind: 'prompt', text: prompt.text, at });
    const content = Array.isArray(rec.message?.content) ? (rec.message.content as ClaudeBlock[]) : [];
    for (const b of content) {
      if (rec.type === 'assistant' && b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ kind: 'said', text: b.text.trim(), at });
      else if (rec.type === 'assistant' && b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) out.push({ kind: 'thought', text: b.thinking.trim(), at });
      else if (rec.type === 'assistant' && b?.type === 'tool_use' && CLAUDE_EDITS.has(b.name ?? '')) {
        const path = b.input?.file_path ?? b.input?.notebook_path;
        if (typeof path === 'string') out.push({ kind: 'edit', id: b.id ?? null, path, at });
      } else if (rec.type === 'user' && b?.type === 'tool_result' && b.is_error && b.tool_use_id) out.push({ kind: 'failed', id: b.tool_use_id });
    }
  }
  return out;
}

type CopilotEvent = {
  type?: string;
  timestamp?: string;
  data?: { content?: unknown; reasoningText?: unknown; toolName?: string; toolCallId?: string; arguments?: { path?: unknown }; success?: boolean };
};

/** A Copilot CLI `events.jsonl` as events. */
export function copilotEvents(raw: string): TraceEvent[] {
  const out: TraceEvent[] = [];
  for (const ev of parsedLines<CopilotEvent>(raw)) {
    const at = ev.timestamp ?? null;
    const d = ev.data;
    if (ev.type === 'user.message' && typeof d?.content === 'string' && d.content.trim()) out.push({ kind: 'prompt', text: d.content.trim(), at });
    else if (ev.type === 'assistant.message') {
      if (typeof d?.reasoningText === 'string' && d.reasoningText.trim()) out.push({ kind: 'thought', text: d.reasoningText.trim(), at });
      if (typeof d?.content === 'string' && d.content.trim()) out.push({ kind: 'said', text: d.content.trim(), at });
    } else if (ev.type === 'tool.execution_start' && COPILOT_EDITS.has(d?.toolName ?? '') && typeof d?.arguments?.path === 'string') {
      out.push({ kind: 'edit', id: d.toolCallId ?? null, path: d.arguments.path, at });
    } else if (ev.type === 'tool.execution_complete' && d?.success === false && d.toolCallId) out.push({ kind: 'failed', id: d.toolCallId });
  }
  return out;
}

/** The step file this absolute path is, if any. By ending, since a session can run in any worktree of the repo. */
const stepFile = (path: string, files: string[]) => files.find((f) => path === f || path.endsWith(`/${f}`));

/** The parts of a session where the agent edited these files. An edit that failed doesn't count. Pure. */
export function stepTurns(events: TraceEvent[], files: string[], subagent = false): StepTraceTurn[] {
  const failed = new Set(events.flatMap((e) => (e.kind === 'failed' ? [e.id] : [])));
  const turns: StepTraceTurn[] = [];
  let prompt: string | null = null;
  let turn: StepTraceTurn | null = null;
  let said: string | null = null;
  for (const e of events) {
    if (e.kind === 'prompt') {
      prompt = e.text;
      turn = null;
      said = null;
    } else if (e.kind === 'said') said = e.text;
    else if (e.kind === 'edit' && !(e.id && failed.has(e.id))) {
      const file = stepFile(e.path, files);
      if (!file) continue;
      if (!turn) turns.push((turn = { prompt, subagent, at: e.at, entries: [] }));
      if (said) turn.entries.push({ kind: 'text', text: said });
      said = null;
      turn.entries.push({ kind: 'tool', text: `Edited ${file}` });
    }
  }
  return turns.map((t) => ({ ...t, entries: foldRepeats(t.entries) }));
}

/** Five edits in a row to one file read better as one line. */
function foldRepeats(entries: RunLogEntry[]): RunLogEntry[] {
  const out: (RunLogEntry & { n: number })[] = [];
  for (const e of entries) {
    const last = out.at(-1);
    if (last && last.kind === e.kind && last.text === e.text) last.n++;
    else out.push({ ...e, n: 1 });
  }
  return out.map(({ n, ...e }) => (n > 1 ? { ...e, text: `${e.text} (${n} times)` } : e));
}

export interface BranchScope {
  branch: string;
  baseName: string;
}

/** Whether a stretch on this branch can be the start of work on `scope.branch`: the base, where the session started, or a fresh worktree. */
const leadsUpIn = (s: SessionInfo, scope: BranchScope) => (name: string | null) => !name || name === scope.baseName || name === s.originalBranch || name.startsWith('worktree-');

/** A session's work on the branch. Copilot doesn't record branches, so its sessions come whole. An unreadable transcript only costs context. */
async function branchEvents(s: SessionInfo, scope: BranchScope): Promise<TraceEvent[]> {
  try {
    const raw = await readFile(s.file, 'utf8');
    return s.agent === 'copilot' ? copilotEvents(raw) : claudeBranchEvents(raw, scope.branch, leadsUpIn(s, scope));
  } catch {
    return [];
  }
}

/** Where these sessions and their subagents edited a step's files while working on the branch, oldest first. */
export async function readStepTrace(sessions: SessionInfo[], files: string[], scope: BranchScope): Promise<StepTraceTurn[]> {
  const turns = await Promise.all(
    sessions.flatMap((s) => [
      branchEvents(s, scope).then((events) => stepTurns(events, files)),
      ...(s.agent === 'claude-code' ? subagentFiles(s.file) : []).map((f) => readFile(f, 'utf8').then((raw) => stepTurns(claudeSubagentEvents(raw, scope.branch, leadsUpIn(s, scope)), files, true)).catch(() => [])),
    ])
  );
  return turns.flat().sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

const DIGEST_CHARS = 30_000;
const ENTRY_CHARS = 2_000;
const LABEL = { prompt: 'Asked', said: 'Agent', thought: 'Agent, thinking' } as const;

/** What was asked and what the agent said and thought, oldest first. The end wins when it doesn't all fit: that's where it settled. Pure. */
export function sessionDigest(events: TraceEvent[]): string {
  const text = events
    .flatMap((e) => (e.kind === 'prompt' || e.kind === 'said' || e.kind === 'thought' ? [`${LABEL[e.kind]}: ${e.text.length > ENTRY_CHARS ? `${e.text.slice(0, ENTRY_CHARS)} [cut off]` : e.text}`] : []))
    .join('\n\n');
  return text.length > DIGEST_CHARS ? `[earlier part left out]\n${text.slice(-DIGEST_CHARS)}` : text;
}

/**
 * The digest of the sessions behind a branch, oldest first, for the assistant writing its walkthrough. Null when there's nothing to send.
 *
 * Only sessions that assistant ran itself: a session's reasoning stays with the vendor that already has it. An ACP agent's
 * id matches no session, so it gets none.
 */
export async function readSessionDigest(sessions: SessionInfo[], scope: BranchScope & { assistantId: string }): Promise<string | null> {
  const oldestFirst = sessions.filter((s) => s.agent === scope.assistantId).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  const events = await Promise.all(oldestFirst.map((s) => branchEvents(s, scope)));
  return sessionDigest(events.flat()) || null;
}
