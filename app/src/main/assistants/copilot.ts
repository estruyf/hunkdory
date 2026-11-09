// GitHub Copilot behind the Assistant interface, built the same way as Claude Code: a non-interactive CLI
// run, with the same isolation and read/edit limits. A fresh run gets its own session, cleaned up once it
// ends so it never clutters the real session list Hunkdory reads from (sessions/copilot.ts); continuing a
// linked session (a change, or send-back) uses `--resume` and leaves it alone, since that session is the
// real thing. Structured output is asked for in the prompt, since the CLI has no `--json-schema` flag.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, mkdirSync, openSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { explainRunFailure } from '../../shared/assistantText.ts';
import { agentEnv } from '../gitGuard.ts';
import { shellEnv, which } from '../shellEnv.ts';
import type { Assistant, AssistantResult, AssistantRun, RunOptions, SendBackHandle, SendBackOptions } from './types.ts';

/** Read-only git, written the way Copilot's `--allow-tool` expects (`shell(git diff:*)`, not Claude's `Bash(git diff:*)`). */
export const READ_GIT_SHELL = [
  'shell(git diff:*)',
  'shell(git show:*)',
  'shell(git log:*)',
  'shell(git grep:*)',
  'shell(git ls-tree:*)',
  'shell(git cat-file:*)',
  'shell(git status:*)',
];

/** Isolation for runs Hunkdory starts on its own: ignore the branch's AGENTS.md and any MCP servers it defines. */
const ISOLATED = ['--no-custom-instructions', '--disable-builtin-mcps', '--no-auto-update', '--no-ask-user'];

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** A short line about what the run is doing, from one of Copilot's tool calls. */
export function describeTool(name: string, input: Record<string, unknown>, cwd: string): string | null {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const rel = (p: string) => [cwd, real(cwd)].map((c) => relative(c, p)).find((r) => r && !r.startsWith('..')) ?? p;
  if (name === 'bash') {
    const cmd = str('command').trim();
    const file = cmd.match(/^git show \S+?:(\S+)/)?.[1] ?? cmd.match(/^git diff .*-- (\S+)/)?.[1];
    return file ? `Reading ${file}` : short(cmd);
  }
  if (name === 'view') return `Reading ${rel(str('path'))}`;
  if (name === 'grep') return `Searching for "${short(str('pattern'), 40)}"`;
  if (name === 'glob') return `Looking for ${str('pattern')}`;
  if (name === 'edit' || name === 'create') return `Editing ${rel(str('path'))}`;
  return null;
}

/** Copilot's argument list for one run. Exported so tests can snapshot it per mode. */
export function copilotArgs(
  opts: Pick<RunOptions, 'access' | 'schema'> & { session?: RunOptions['session']; allowBash?: RunOptions['allowBash']; sessionId: string; prompt: string }
): string[] {
  const { access, session, allowBash, sessionId, prompt } = opts;
  if (session?.mode === 'continue') {
    // Same as sending a review back: the session itself goes on, and may edit files. Copilot CLI can't
    // fork a session, so a 'copy' session never reaches here (see askAbility in conversations.ts); it's
    // treated as a fresh run instead, below.
    return ['--resume', session.id, '-p', prompt, '--output-format', 'json', '--available-tools', 'bash', 'view', 'grep', 'glob', 'edit', 'create', '--allow-tool', ...READ_GIT_SHELL, 'view', 'grep', 'glob', 'write', ...(allowBash ?? []), ...ISOLATED];
  }
  const name = opts.schema ? 'walkthrough' : access === 'edit' ? 'change' : 'question';
  const base = ['-p', prompt, '--output-format', 'json', '--session-id', sessionId, '--name', `Hunkdory: ${name}`, ...ISOLATED];
  if (access === 'edit') {
    return [...base, '--available-tools', 'bash', 'view', 'grep', 'glob', 'edit', 'create', '--allow-tool', ...READ_GIT_SHELL, 'view', 'grep', 'glob', 'write'];
  }
  const gitOnly = access === 'git-only';
  const tools = gitOnly ? ['bash'] : ['bash', 'view', 'grep', 'glob'];
  const allowed = [...READ_GIT_SHELL, ...(gitOnly ? [] : ['view', 'grep', 'glob'])];
  return [...base, '--available-tools', ...tools, '--allow-tool', ...allowed];
}

/** Asks for the structured reply as plain JSON in the prompt, since Copilot has no `--json-schema`. */
function withSchemaAsk(prompt: string, schema: object): string {
  return `${prompt}\n\nReply with ONLY a single JSON object (no markdown, no code fences, no commentary) matching this JSON schema:\n${JSON.stringify(schema)}`;
}

/** A small, forgiving check of the subset of JSON Schema Hunkdory's schemas use: type, required and items/properties. */
function matchesSchema(value: unknown, schema: Record<string, unknown>): string | null {
  const type = schema.type as string | undefined;
  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'expected an object';
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in obj)) return `missing "${key}"`;
    const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const err = matchesSchema(obj[key], sub);
        if (err) return `"${key}": ${err}`;
      }
    }
    return null;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return 'expected an array';
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) for (const [i, v] of value.entries()) { const err = matchesSchema(v, items); if (err) return `[${i}]: ${err}`; }
    return null;
  }
  if (type === 'string') return typeof value === 'string' ? null : 'expected a string';
  if (type === 'boolean') return typeof value === 'boolean' ? null : 'expected a boolean';
  return null;
}

/** Strips a ```json fence around the reply, in case Copilot added one despite being asked not to. */
function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : text).trim();
}

export function parseStructured(text: string, schema: object): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stripFence(text));
  } catch {
    throw new Error("didn't reply with valid JSON");
  }
  const err = matchesSchema(value, schema as Record<string, unknown>);
  if (err) throw new Error(err);
  return value as Record<string, unknown>;
}

type ToolCall = { name?: string; arguments?: Record<string, unknown> };
type CopilotEvent = { type?: string; data?: { content?: string; toolRequests?: ToolCall[] }; exitCode?: number };

/**
 * One line of Copilot's `--output-format json` (JSONL) stream: the final message's text, the result's exit
 * code, or the activity lines from a message's tool calls. Exported so the event shapes recorded in
 * `test/fixtures/copilot-*.jsonl` can be checked without spawning the CLI.
 */
export function parseCopilotLine(line: string, cwd: string): { text?: string; exitCode?: number | null; activities: string[] } | null {
  let ev: CopilotEvent;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (ev.type === 'result') return { exitCode: ev.exitCode ?? null, activities: [] };
  if (ev.type !== 'assistant.message') return null;
  const text = typeof ev.data?.content === 'string' && ev.data.content.trim() ? ev.data.content : undefined;
  const activities = (ev.data?.toolRequests ?? []).map((tr) => (tr.name ? describeTool(tr.name, tr.arguments ?? {}, cwd) : null)).filter((a): a is string => !!a);
  return { text, activities };
}

/** One `copilot -p ... --output-format json` run: streams its JSONL events and resolves with the final message. */
function runCopilot(opts: { copilot: string; cwd: string; env: NodeJS.ProcessEnv; args: string[]; logFile: string; timeoutMs: number; onActivity?: (line: string) => void }): AssistantRun {
  const { cwd } = opts;
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const log = createWriteStream(opts.logFile, { flags: 'a' });
  const child = spawn(opts.copilot, opts.args, { cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let killed = false;
  const timer = setTimeout(() => child.kill(), opts.timeoutMs);

  let text = '';
  let exitCode: number | null = null;
  let stderr = '';
  child.stderr!.on('data', (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-2000);
    log.write(b);
  });
  createInterface({ input: child.stdout! }).on('line', (line) => {
    log.write(`${line}\n`);
    const parsed = parseCopilotLine(line, cwd);
    if (!parsed) return;
    if (typeof parsed.exitCode !== 'undefined') exitCode = parsed.exitCode;
    if (parsed.text) text = parsed.text;
    if (opts.onActivity) for (const activity of parsed.activities) opts.onActivity(activity);
  });

  const done: Promise<AssistantResult> = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () => resolve());
  })
    .finally(() => {
      clearTimeout(timer);
      log.end();
    })
    .then(() => {
      if (killed) throw new Error('Stopped.');
      if (exitCode === 0) return { text, structured: null };
      const why = stderr.trim().split('\n').at(-1) || (exitCode === null ? `it took longer than ${Math.round(opts.timeoutMs / 60_000)} minutes` : `exit code ${exitCode}`);
      throw new Error(explainRunFailure({ id: 'copilot', name: 'Copilot' }, why));
    });

  return {
    done,
    kill() {
      killed = true;
      child.kill();
    },
  };
}

/** Deletes a run's own session-state folder once it ends, so it never clutters the real session list Hunkdory reads from in a later slice. */
async function forgetOwnSession(sessionId: string) {
  await rm(join(homedir(), '.copilot', 'session-state', sessionId), { recursive: true, force: true }).catch(() => {});
}

export class CopilotAssistant implements Assistant {
  id = 'copilot';
  name = 'GitHub Copilot';

  async available() {
    // Copilot runs its commands in PowerShell on Windows, where Hunkdory's git guard (gitGuard.ts) can't stop
    // `git grep -O` or `git log --output` from code under review. Until it can, Copilot isn't offered there.
    if (process.platform === 'win32') return { ok: false as const, reason: "Copilot isn't supported on Windows yet. Use Claude Code." };
    const copilot = await which('copilot', { ...(await shellEnv()) });
    return copilot ? { ok: true as const } : { ok: false as const, reason: 'The Copilot CLI is not installed.' };
  }

  async run(opts: RunOptions): Promise<AssistantRun> {
    const env = await agentEnv();
    const copilot = await which('copilot', env);
    if (!copilot) throw new Error('Could not find the "copilot" command. Is the Copilot CLI installed?');

    // Copilot can't fork a session like Claude Code's `--resume --fork-session`: a 'copy' session is run
    // fresh instead, same as no session at all. askAbility (conversations.ts) never asks for 'copy' here,
    // but this keeps `run()` correct regardless of who calls it.
    const continuing = opts.session?.mode === 'continue';
    const sessionId = continuing ? opts.session!.id : randomUUID();
    const prompt = opts.schema ? withSchemaAsk(opts.prompt, opts.schema) : opts.prompt;
    const args = copilotArgs({ access: opts.access, schema: opts.schema, session: continuing ? opts.session : null, allowBash: opts.allowBash, sessionId, prompt });
    let killed = false;
    let current = runCopilot({ copilot, cwd: opts.cwd, env, args, logFile: opts.logFile, timeoutMs: opts.timeoutMs, onActivity: opts.onActivity });

    const done = (async (): Promise<AssistantResult> => {
      try {
        const out = await current.done;
        if (!opts.schema) return out;
        try {
          return { text: out.text, structured: parseStructured(out.text, opts.schema) };
        } catch (e) {
          if (killed) throw e;
          // One retry, in the same session, with what was wrong with the first reply.
          const retryPrompt = `Your last reply ${(e as Error).message}. Reply again with ONLY the JSON object, matching the schema.`;
          current = runCopilot({
            copilot,
            cwd: opts.cwd,
            env,
            args: ['-p', retryPrompt, '--output-format', 'json', '--resume', sessionId, ...ISOLATED],
            logFile: opts.logFile,
            timeoutMs: opts.timeoutMs,
            onActivity: opts.onActivity,
          });
          const retryOut = await current.done;
          return { text: retryOut.text, structured: parseStructured(retryOut.text, opts.schema) };
        }
      } finally {
        // A continuing session is the user's real one, linked to a branch: never delete it. Only a run's
        // own fresh session is cleaned up, so it never clutters the real session list Hunkdory reads from.
        if (!continuing) await forgetOwnSession(sessionId);
      }
    })();

    return {
      done,
      kill() {
        killed = true;
        current.kill();
      },
    };
  }

  async sendBack(opts: SendBackOptions): Promise<SendBackHandle> {
    const env = await agentEnv();
    const copilot = await which('copilot', env);
    if (!copilot) throw new Error('Could not find the "copilot" command. Is the Copilot CLI installed?');

    const args = copilotArgs({ access: 'edit', session: { id: opts.session.id, mode: 'continue' }, allowBash: opts.allowBash, sessionId: opts.session.id, prompt: opts.prompt });
    mkdirSync(dirname(opts.logFile), { recursive: true });
    const fd = openSync(opts.logFile, 'a');
    const child = spawn(copilot, args, { cwd: opts.session.cwd, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
    closeSync(fd);
    child.unref();
    child.on('exit', (code) => opts.onExit?.(code === 0, code === 0 ? 'The agent finished working on your feedback.' : `The agent run stopped with exit code ${code}. See the log for details.`));
    child.on('error', (e) => opts.onExit?.(false, e.message));
    return { pid: child.pid, logFile: opts.logFile };
  }
}
