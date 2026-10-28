// One headless Claude Code run: streams its events, reports what it's doing, resolves with the final result.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';

/** Read-only git, for runs that look at a branch without changing it. */
export const READ_GIT = ['Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git grep:*)', 'Bash(git ls-tree:*)', 'Bash(git cat-file:*)', 'Bash(git status:*)'];

/**
 * For runs Reviewer starts on its own, in code it is reviewing:
 * ignore the branch's .claude settings and MCP servers (they could run hooks or tools from that code),
 * and don't save the run as a session, so Reviewer never mistakes it for the agent that made the branch.
 */
export const ISOLATED = ['--setting-sources', 'user', '--strict-mcp-config', '--no-session-persistence'];

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** A short line about what the run is doing, from one of its tool calls. */
export function describeTool(name: string, input: Record<string, unknown>, cwd: string): string | null {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  // Paths can come through a symlink (/var is /private/var on macOS), so try the real folder too.
  const rel = (p: string) => [cwd, real(cwd)].map((c) => relative(c, p)).find((r) => r && !r.startsWith('..')) ?? p;
  if (name === 'Bash') {
    // Claude often starts with `cd <folder> &&`; the part after it says more.
    const cmd = str('command').trim().replace(/^cd \S+ && /, '');
    const file = cmd.match(/^git show \S+?:(\S+)/)?.[1] ?? cmd.match(/^git diff .*-- (\S+)/)?.[1];
    return file ? `Reading ${file}` : short(cmd);
  }
  if (name === 'Read') return `Reading ${rel(str('file_path'))}`;
  if (name === 'Grep') return `Searching for "${short(str('pattern'), 40)}"`;
  if (name === 'Glob') return `Looking for ${str('pattern')}`;
  if (name === 'Edit' || name === 'Write') return `Editing ${rel(str('file_path'))}`;
  return null;
}

export interface ClaudeResult {
  /** The final message. */
  text: string;
  structured: Record<string, unknown> | null;
}

export interface ClaudeRun {
  done: Promise<ClaudeResult>;
  kill(): void;
}

export function runClaude(opts: { claude: string; cwd: string; env: NodeJS.ProcessEnv; args: string[]; logFile: string; timeoutMs: number; onActivity?: (line: string) => void }): ClaudeRun {
  const { cwd } = opts;
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = createWriteStream(opts.logFile);
  const child = spawn(opts.claude, ['--output-format', 'stream-json', '--verbose', ...opts.args], { cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let killed = false;
  const timer = setTimeout(() => child.kill(), opts.timeoutMs);

  type Result = { is_error?: boolean; subtype?: string; result?: string; structured_output?: Record<string, unknown> };
  const got: { result: Result | null } = { result: null };
  let stderr = '';
  child.stderr!.on('data', (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-2000);
    log.write(b);
  });
  createInterface({ input: child.stdout! }).on('line', (line) => {
    log.write(`${line}\n`);
    let ev: { type?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] } };
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.type === 'result') got.result = ev as Result;
    if (ev.type !== 'assistant' || !opts.onActivity) return;
    for (const c of ev.message?.content ?? []) {
      const activity = c.type === 'tool_use' && c.name ? describeTool(c.name, c.input ?? {}, cwd) : null;
      if (activity) opts.onActivity(activity);
    }
  });

  const done = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  })
    .finally(() => {
      clearTimeout(timer);
      log.end();
    })
    .then((code) => {
      if (killed) throw new Error('Stopped.');
      const r = got.result;
      if (r && !r.is_error) return { text: r.result ?? '', structured: r.structured_output ?? null };
      const why = r?.is_error ? r.result || r.subtype : stderr.trim().split('\n').at(-1) || (code === null ? `it took longer than ${Math.round(opts.timeoutMs / 60_000)} minutes` : `exit code ${code}`);
      throw new Error(`Claude Code stopped without an answer (${why}).`);
    });

  return {
    done,
    kill() {
      killed = true;
      child.kill();
    },
  };
}
