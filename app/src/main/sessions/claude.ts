// Claude Code sessions: <config dir>/projects/<encoded cwd>/<session id>.jsonl
//
// The config dir is ~/.claude unless CLAUDE_CONFIG_DIR points elsewhere. People with
// several accounts keep several (~/.claude-work, ...), so every one of them is searched.
//
// Verified against Claude Code 2.1.30x transcripts:
// - The folder name is the cwd with every non-alphanumeric character replaced by "-".
//   That is lossy, so we encode forward and confirm with each record's `cwd`.
// - Sessions in a Claude Code worktree live under "<project>--claude-worktrees-<name>"
//   and carry a `worktree-state` record with the branch they started from.
// - `gitBranch` is per record and can change during a session.
// - Subagent transcripts sit in "<session id>/subagents/" and are marked `isSidechain`.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { SessionInfo, TestRun } from '../../shared/types.ts';

export const DEFAULT_CONFIG_DIR = join(homedir(), '.claude');

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Claude Code config dirs that hold sessions: ~/.claude, $CLAUDE_CONFIG_DIR, and any ~/.claude-* or ~/.claude.* folder. */
export function claudeConfigDirs(home = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = new Set<string>([join(home, '.claude')]);
  if (env.CLAUDE_CONFIG_DIR) dirs.add(resolve(env.CLAUDE_CONFIG_DIR.replace(/^~(?=\/|$)/, home)));
  let names: string[] = [];
  try {
    names = readdirSync(home);
  } catch {}
  for (const n of names.sort()) if (/^\.claude[-.]/.test(n)) dirs.add(join(home, n));
  return [...dirs].filter((d) => isDir(join(d, 'projects')));
}

const projectsDirs = (configDirs?: string[]) => (configDirs ?? claudeConfigDirs()).map((d) => join(d, 'projects'));

export function encodeProjectPath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-');
}

/** Context Claude Code injects into a user turn. Not part of what the user typed. */
const INJECTED = /<(ide_opened_file|ide_selection|system-reminder|browser_instruction|ide_diagnostics)>[\s\S]*?<\/\1>/g;
const NOT_A_PROMPT = /^(<local-command-std(out|err)>|<task-notification>|<bash-(input|stdout|stderr)>|\[Request interrupted|Caveat: The messages below)/;

/**
 * A test runner in command position: at the start, or after &&, ;, | or (, optionally behind npx and env vars.
 * So `cd x && npm test | tail` counts, and `grep -rn "vitest"` doesn't.
 */
const TEST_CMD =
  /(?:^|[;&|(]\s*)(?:\w+=\S+\s+)*(?:npx\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:\.\/)?(?:node_modules\/\.bin\/)?(?:vitest|jest|pytest|mocha)\b|playwright\s+test\b|(?:go|dotnet|cargo)\s+test\b|node\s+(?:--\S+\s+)*--test\b|(?:gulp|heft)\s+test\b)/m;

/** A command without its heredoc bodies: a script fed to python3 can mention npm test without running it. */
function withoutHeredocs(cmd: string) {
  const out: string[] = [];
  let end: string | null = null;
  for (const line of cmd.split('\n')) {
    if (end) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    end = line.match(/<<-?\s*['"]?(\w+)['"]?/)?.[1] ?? null;
  }
  return out.join('\n');
}
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FAILED = /\b[1-9]\d*\s+(?:failed|failing|failures?)\b|ℹ fail [1-9]|^\s*FAIL\b|✖|npm ERR!|Tests?:\s+[1-9]\d* failed/im;
const PASSED = /\b[1-9]\d*\s+(?:passed|passing)\b|ℹ pass [1-9]|^\s*PASS\b|✔|\bAll tests passed\b|^ok\b/im;

/** Passed, failed or unknown, from the exit status and the output that came back. */
export function testResult(isError: boolean, output: string): TestRun['result'] {
  if (isError || FAILED.test(output)) return 'failed';
  return PASSED.test(output) ? 'passed' : 'unknown';
}

/** The interesting part of a command: without a leading `cd somewhere &&`, on one line. */
function shortCommand(cmd: string) {
  const line = cmd.replace(/^\s*cd\s+\S+\s*&&\s*/, '').split('\n')[0].trim();
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

/** A content block of a message: text, a tool call, or a tool's result. */
interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: { command?: unknown };
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface Rec {
  type?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  promptSource?: string;
  toolUseResult?: unknown;
  message?: { content?: unknown };
  aiTitle?: string;
  customTitle?: string;
  worktreeSession?: { worktreePath?: string; worktreeBranch?: string; originalBranch?: string };
}

/**
 * What the user typed in a user record, or null when the record isn't a prompt
 * (tool results, meta records, subagent turns, task notifications, command output).
 * `slashOnly` is set for a slash command without arguments, which is a weak prompt.
 */
export function promptText(rec: Rec): { text: string; slashOnly: boolean } | null {
  if (rec.type !== 'user' || rec.toolUseResult || rec.isMeta || rec.isSidechain) return null;
  if (rec.promptSource === 'system') return null;
  const content = rec.message?.content;
  let raw = '';
  if (typeof content === 'string') raw = content;
  else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return null;
    raw = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
  }
  const text = raw.replace(INJECTED, '').trim();
  if (!text || NOT_A_PROMPT.test(text)) return null;

  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1].trim();
  if (name) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim() ?? '';
    return args ? { text: `${name} ${args}`, slashOnly: false } : { text: name, slashOnly: true };
  }
  if (text.startsWith('<command-message>')) return null;
  return { text, slashOnly: false };
}

/** Parse one transcript. Returns null for files with no conversation in them. */
export function parseTranscript(text: string, file: string, id: string, configDir = DEFAULT_CONFIG_DIR): SessionInfo | null {
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let title: string | null = null;
  let customTitle: string | null = null;
  let originalBranch: string | null = null;
  let worktreePath: string | null = null;
  let firstPrompt: string | null = null;
  let firstSlash: string | null = null;
  const branches = new Map<string, { firstSeen: string; lastSeen: string }>();
  const testRuns: TestRun[] = [];
  const pending = new Map<string, { command: string; at: string }>();
  let lastEditAt: string | null = null;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec: Rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // A transcript being written can end in a partial line.
    }
    if (rec.type === 'ai-title' && rec.aiTitle) title = rec.aiTitle;
    if (rec.type === 'custom-title' && rec.customTitle) customTitle = rec.customTitle;
    if (rec.type === 'worktree-state' && rec.worktreeSession) {
      originalBranch = rec.worktreeSession.originalBranch ?? originalBranch;
      worktreePath = rec.worktreeSession.worktreePath ?? worktreePath;
    }
    if (rec.isSidechain) continue;
    if (rec.cwd) cwd = rec.cwd;
    if (rec.timestamp && (rec.type === 'user' || rec.type === 'assistant')) {
      startedAt ??= rec.timestamp;
      endedAt = rec.timestamp;
      if (rec.gitBranch && rec.gitBranch !== 'HEAD') {
        // Re-insert so the map stays ordered by last use.
        const firstSeen = branches.get(rec.gitBranch)?.firstSeen ?? rec.timestamp;
        branches.delete(rec.gitBranch);
        branches.set(rec.gitBranch, { firstSeen, lastSeen: rec.timestamp });
      }
    }
    const content = Array.isArray(rec.message?.content) ? (rec.message.content as Block[]) : [];
    for (const b of content) {
      if (rec.type === 'assistant' && b?.type === 'tool_use' && rec.timestamp) {
        if (EDIT_TOOLS.has(b.name ?? '')) lastEditAt = rec.timestamp;
        const cmd = b.name === 'Bash' && typeof b.input?.command === 'string' ? (b.input.command as string) : null;
        if (cmd && b.id && TEST_CMD.test(withoutHeredocs(cmd))) pending.set(b.id, { command: shortCommand(cmd), at: rec.timestamp });
      } else if (rec.type === 'user' && b?.type === 'tool_result' && b.tool_use_id && pending.has(b.tool_use_id)) {
        const out = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x: { text?: string }) => x?.text ?? '').join('\n') : '';
        testRuns.push({ ...pending.get(b.tool_use_id)!, result: testResult(!!b.is_error, out) });
        pending.delete(b.tool_use_id);
      }
    }
    if (!firstPrompt) {
      const p = promptText(rec);
      if (p?.slashOnly) firstSlash ??= p.text;
      else if (p) firstPrompt = p.text;
    }
  }

  if (!cwd || !startedAt) return null;
  return {
    id,
    file,
    configDir,
    cwd,
    branches: [...branches].map(([name, seen]) => ({ name, ...seen })),
    originalBranch,
    worktreePath,
    firstPrompt: firstPrompt ?? firstSlash,
    title: customTitle ?? title,
    startedAt,
    endedAt,
    testRuns,
    lastEditAt,
  };
}

const cache = new Map<string, { mtimeMs: number; size: number; info: SessionInfo | null }>();

/** Session folders, in every config dir, that may belong to a repo at `root` (or to one of its worktrees). */
export function sessionDirsFor(paths: string[], configDirs?: string[]): string[] {
  const prefixes = paths.map(encodeProjectPath);
  const out: string[] = [];
  for (const projectsDir of projectsDirs(configDirs)) {
    let names: string[];
    try {
      names = readdirSync(projectsDir);
    } catch {
      continue;
    }
    for (const n of names) if (prefixes.some((p) => n === p || n.startsWith(`${p}-`))) out.push(join(projectsDir, n));
  }
  return out;
}

/** True when a session ran inside the repo or one of its worktrees. */
export function belongsTo(s: SessionInfo, paths: string[]): boolean {
  const inside = (p: string | null) => !!p && paths.some((root) => p === root || p.startsWith(`${root}/`));
  return inside(s.cwd) || inside(s.worktreePath);
}

export function readSessions(dirs: string[]): SessionInfo[] {
  const out: SessionInfo[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(dir, f);
      try {
        const st = statSync(file);
        const hit = cache.get(file);
        if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
          if (hit.info) out.push(hit.info);
          continue;
        }
        // <config dir>/projects/<encoded cwd>/<id>.jsonl
        const info = parseTranscript(readFileSync(file, 'utf8'), file, f.replace(/\.jsonl$/, ''), dirname(dirname(dir)));
        cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
        if (info) out.push(info);
      } catch {
        // Unreadable transcript: skip it, it only costs context.
      }
    }
  }
  return out;
}

/** Repos with Claude Code sessions on this machine, for the Welcome screen. */
export function scanSessionFolders(configDirs?: string[]): { cwd: string; sessions: number; lastActive: number }[] {
  const out = [];
  const folders = projectsDirs(configDirs).flatMap((p) => {
    try {
      return readdirSync(p).map((n) => join(p, n));
    } catch {
      return [];
    }
  });
  for (const dir of folders) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    if (!files.length) continue;
    let lastActive = 0;
    let newest = files[0];
    for (const f of files) {
      const m = statSync(join(dir, f)).mtimeMs;
      if (m > lastActive) {
        lastActive = m;
        newest = f;
      }
    }
    const cwd = firstCwd(join(dir, newest));
    if (cwd) out.push({ cwd, sessions: files.length, lastActive });
  }
  return out;
}

/** Read just enough of a transcript to find its cwd. */
function firstCwd(file: string): string | null {
  const buf = Buffer.alloc(256 * 1024);
  const fd = openSync(file, 'r');
  let n: number;
  try {
    n = readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  const head = buf.subarray(0, n).toString('utf8');
  const m = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
  return m ? JSON.parse(`"${m[1]}"`) : null;
}
