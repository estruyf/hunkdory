// Claude Code behind the Assistant interface: one headless run streams its events and resolves with the
// result; a send-back run is detached and only reports how it ended.
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { explainRunFailure } from '../../shared/assistantText.ts';
import { DEFAULT_CONFIG_DIR } from '../sessions/claude.ts';
import { agentEnv } from '../gitGuard.ts';
import { shellEnv, which } from '../shellEnv.ts';
import type { Assistant, AssistantResult, AssistantRun, AssistantSession, RunOptions, SendBackHandle, SendBackOptions } from './types.ts';

/** Read-only git, for runs that look at a branch without changing it. */
export const READ_GIT = ['Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git grep:*)', 'Bash(git ls-tree:*)', 'Bash(git cat-file:*)', 'Bash(git status:*)'];

/**
 * For runs Hunkdory starts on its own, in code it is reviewing:
 * ignore the branch's .claude settings and MCP servers (they could run hooks or tools from that code),
 * and don't save the run as a session, so Hunkdory never mistakes it for the agent that made the branch.
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

/** Claude Code's argument list for one run. Exported so tests can snapshot it per mode. */
export function claudeArgs(opts: Pick<RunOptions, 'prompt' | 'access' | 'session' | 'schema' | 'allowBash'>): string[] {
  const { prompt, access, session, schema, allowBash } = opts;
  if (session?.mode === 'copy') {
    // A copy of the session: the agent remembers why it did things, and the original session stays as it was.
    return ['--resume', session.id, '--fork-session', '--no-session-persistence', '--print', prompt, '--tools', 'Bash', 'Read', 'Grep', 'Glob', '--allowedTools', ...READ_GIT, 'Read', 'Grep', 'Glob'];
  }
  if (session?.mode === 'continue') {
    // Same as sending a review back: the session itself goes on, and may edit files.
    return ['--resume', session.id, '--print', prompt, '--permission-mode', 'acceptEdits', '--allowedTools', ...(allowBash ?? []), ...READ_GIT];
  }
  if (access === 'edit') {
    return ['--print', prompt, '--permission-mode', 'acceptEdits', '--tools', 'Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', '--allowedTools', ...READ_GIT, ...ISOLATED];
  }
  const gitOnly = access === 'git-only';
  const schemaArgs = schema ? ['--json-schema', JSON.stringify(schema)] : [];
  const tools = gitOnly ? ['Bash'] : ['Bash', 'Read', 'Grep', 'Glob'];
  const allowed = [...READ_GIT, ...(gitOnly ? [] : ['Read', 'Grep', 'Glob'])];
  return ['--print', prompt, ...schemaArgs, '--tools', ...tools, '--allowedTools', ...allowed, ...ISOLATED];
}

/** Claude Code's environment, pointed at the config dir a session lives in. */
async function claudeEnv(session: AssistantSession | SendBackOptions['session'] | null): Promise<{ env: NodeJS.ProcessEnv; claude: string }> {
  const env = await agentEnv();
  // Sessions from another config dir (~/.claude-work, ...) only resume with that dir set.
  if (session?.configDir && session.configDir !== DEFAULT_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = session.configDir;
  else if (session) delete env.CLAUDE_CONFIG_DIR;
  const claude = await which('claude', env);
  if (!claude) throw new Error('Could not find the "claude" command. Is Claude Code installed?');
  return { env, claude };
}

function runClaude(opts: { claude: string; cwd: string; env: NodeJS.ProcessEnv; args: string[]; logFile: string; timeoutMs: number; onActivity?: (line: string) => void }): AssistantRun {
  const { cwd } = opts;
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = createWriteStream(opts.logFile);
  const child = spawn(opts.claude, ['--output-format', 'stream-json', '--verbose', ...opts.args], { cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let killed = false;
  const timer = setTimeout(() => child.kill(), opts.timeoutMs);

  type Result = { is_error?: boolean; subtype?: string; result?: string; structured_output?: Record<string, unknown>; total_cost_usd?: number };
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

  const done: Promise<AssistantResult> = new Promise<number | null>((resolve, reject) => {
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
      if (r && !r.is_error) return { text: r.result ?? '', structured: r.structured_output ?? null, ...(typeof r.total_cost_usd === 'number' && { costUsd: r.total_cost_usd }) };
      const why = r?.is_error ? r.result || r.subtype : stderr.trim().split('\n').at(-1) || (code === null ? `it took longer than ${Math.round(opts.timeoutMs / 60_000)} minutes` : `exit code ${code}`);
      throw new Error(explainRunFailure({ id: 'claude-code', name: 'Claude Code' }, why ?? 'no reason given'));
    });

  return {
    done,
    kill() {
      killed = true;
      child.kill();
    },
  };
}

export class ClaudeAssistant implements Assistant {
  id = 'claude-code';
  name = 'Claude Code';

  async available() {
    const claude = await which('claude', { ...(await shellEnv()) });
    return claude ? { ok: true as const } : { ok: false as const, reason: 'Claude Code is not installed.' };
  }

  async run(opts: RunOptions): Promise<AssistantRun> {
    const { env, claude } = await claudeEnv(opts.session);
    const args = claudeArgs(opts);
    return runClaude({ claude, cwd: opts.cwd, env, args, logFile: opts.logFile, timeoutMs: opts.timeoutMs, onActivity: opts.onActivity });
  }

  async sendBack(opts: SendBackOptions): Promise<SendBackHandle> {
    const { env, claude } = await claudeEnv(opts.session);
    const args = [
      '--resume', opts.session.id,
      '--print', opts.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      // Edits are allowed so the agent can fix things. Shell access is limited to the verifier and read-only git.
      '--permission-mode', 'acceptEdits',
      '--allowedTools', ...opts.allowBash, 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)',
    ];
    mkdirSync(dirname(opts.logFile), { recursive: true });
    const fd = openSync(opts.logFile, 'a');
    const child = spawn(claude, args, { cwd: opts.session.cwd, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
    closeSync(fd);
    child.unref();
    child.on('exit', (code) => opts.onExit?.(code === 0, code === 0 ? 'The agent finished working on your feedback.' : `The agent run stopped with exit code ${code}. See the log for details.`));
    child.on('error', (e) => opts.onExit?.(false, e.message));
    return { pid: child.pid, logFile: opts.logFile };
  }
}
