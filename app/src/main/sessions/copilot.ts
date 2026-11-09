// Copilot CLI sessions: ~/.copilot/session-state/<session id>/
//
// Each session folder has `workspace.yaml` (id, cwd, git_root, branch, name, created_at, updated_at) and
// `events.jsonl`, the turn-by-turn transcript. Verified against Copilot CLI 1.0.105:
// - `workspace.yaml` is flat `key: value` lines, quoting a value only when it needs it (a colon, a comma).
//   Not a general YAML document, so a small scalar parser is enough; no dependency needed.
// - `branch` is only the branch checked out as of the session's *last* turn, not a history like Claude
//   Code's `gitBranch` per record: Copilot doesn't track which branches a session touched. Matching a
//   session to a branch therefore leans on `cwd` instead (see match.ts and projects.ts).
// - Resuming (`copilot --resume <id>`) appends to the same `events.jsonl` and moves `branch`/`updated_at`
//   forward; it never rewrites earlier turns.
// - Folders starting with "." (like ".session-operation-locks") aren't sessions.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionInfo } from '../../shared/types.ts';
import { gitPath } from '../paths.ts';
import { TEST_CMD, shortCommand, testResult, withoutHeredocs } from './testcmd.ts';

export const DEFAULT_SESSIONS_DIR = join(homedir(), '.copilot', 'session-state');

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}

/** The handful of flat `key: value` lines Copilot writes to `workspace.yaml`. Not a general YAML parser. */
export function parseWorkspaceYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

interface Event {
  type?: string;
  timestamp?: string;
  data?: {
    content?: string;
    toolName?: string;
    toolCallId?: string;
    arguments?: { command?: unknown };
    success?: boolean;
    result?: { content?: unknown };
  };
}

export const EDIT_TOOLS = new Set(['edit', 'create']);

/** Parse one session's `events.jsonl`: the fields `workspace.yaml` doesn't carry. Exported for fixture tests. */
export function parseCopilotEvents(text: string): { firstPrompt: string | null; testRuns: SessionInfo['testRuns']; lastEditAt: string | null } {
  let firstPrompt: string | null = null;
  let lastEditAt: string | null = null;
  const testRuns: SessionInfo['testRuns'] = [];
  const pending = new Map<string, { command: string; at: string }>();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let ev: Event;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // A transcript being written can end in a partial line.
    }
    if (ev.type === 'user.message' && firstPrompt === null && typeof ev.data?.content === 'string') firstPrompt = ev.data.content;
    if (ev.type === 'tool.execution_start' && ev.timestamp) {
      const name = ev.data?.toolName;
      if (name && EDIT_TOOLS.has(name)) lastEditAt = ev.timestamp;
      const cmd = (name === 'bash' || name === 'powershell') && typeof ev.data?.arguments?.command === 'string' ? (ev.data.arguments.command as string) : null;
      if (cmd && ev.data?.toolCallId && TEST_CMD.test(withoutHeredocs(cmd))) pending.set(ev.data.toolCallId, { command: shortCommand(cmd), at: ev.timestamp });
    } else if (ev.type === 'tool.execution_complete' && ev.data?.toolCallId && pending.has(ev.data.toolCallId)) {
      const content = ev.data.result?.content;
      testRuns.push({ ...pending.get(ev.data.toolCallId)!, result: testResult(ev.data.success === false, typeof content === 'string' ? content : '') });
      pending.delete(ev.data.toolCallId);
    }
  }
  return { firstPrompt, testRuns, lastEditAt };
}

/** One session folder's `workspace.yaml` + `events.jsonl`, or null when it isn't a usable session. Exported for tests. */
export function parseCopilotSession(id: string, workspaceYaml: string, eventsJsonl: string, eventsFile: string): SessionInfo | null {
  const meta = parseWorkspaceYaml(workspaceYaml);
  if (!meta.cwd || !meta.created_at) return null;
  const { firstPrompt, testRuns, lastEditAt } = parseCopilotEvents(eventsJsonl);
  return {
    id,
    file: eventsFile,
    agent: 'copilot',
    configDir: null,
    cwd: gitPath(meta.cwd),
    branches: [],
    originalBranch: null,
    worktreePath: null,
    firstPrompt,
    title: meta.name || null,
    startedAt: meta.created_at,
    endedAt: meta.updated_at || meta.created_at,
    testRuns,
    lastEditAt,
  };
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const cache = new Map<string, { mtimeMs: number; size: number; info: SessionInfo | null }>();

/** Every Copilot CLI session on this machine. */
export function readCopilotSessions(baseDir = DEFAULT_SESSIONS_DIR): SessionInfo[] {
  let ids: string[];
  try {
    ids = readdirSync(baseDir).filter((n) => !n.startsWith('.') && isDir(join(baseDir, n)));
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const id of ids) {
    const dir = join(baseDir, id);
    const wsFile = join(dir, 'workspace.yaml');
    const eventsFile = join(dir, 'events.jsonl');
    try {
      const st = statSync(wsFile);
      const hit = cache.get(dir);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
        if (hit.info) out.push(hit.info);
        continue;
      }
      let events = '';
      try {
        events = readFileSync(eventsFile, 'utf8');
      } catch {
        // A session with no turns yet (or its transcript was cleaned up): still worth the cwd/prompt it has.
      }
      const info = parseCopilotSession(id, readFileSync(wsFile, 'utf8'), events, eventsFile);
      cache.set(dir, { mtimeMs: st.mtimeMs, size: st.size, info });
      if (info) out.push(info);
    } catch {
      // Unreadable or mid-write: skip it, it only costs context.
    }
  }
  return out;
}

/** True when a session ran inside the repo or one of its worktrees. Same rule as Claude Code's. */
export function belongsTo(s: SessionInfo, paths: string[]): boolean {
  return paths.some((root) => s.cwd === root || s.cwd.startsWith(`${root}/`));
}
