// Any agent that speaks the Agent Client Protocol (ACP) v1 over stdio: Gemini CLI, codex-acp, or anything
// else someone points Hunkdory at. Unlike Claude Code and Copilot, these agents call back into Hunkdory
// mid-run (to ask permission for a tool call, or to read a file), so this is a small JSON-RPC-over-stdio
// client rather than a one-shot subprocess. No session persistence yet: `sendBack()` isn't supported, since
// an ACP agent's own on-disk session format isn't something Hunkdory can safely read or resume.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { tryGit } from '../git.ts';
import { agentEnv } from '../gitGuard.ts';
import { shellEnv, which, pathOnlyEnv } from '../shellEnv.ts';
import { parseStructured } from './copilot.ts';
import type { Access, Assistant, AssistantResult, AssistantRun, RunOptions, SendBackHandle, SendBackOptions } from './types.ts';

export interface AcpAgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
}

const PROTOCOL_VERSION = 1;

/** Read-only git commands an agent's `execute` tool calls may run without asking again, same rule as Claude's READ_GIT and Copilot's READ_GIT_SHELL. */
const READ_GIT_CMD = /^git (diff|show|log|grep|ls-tree|cat-file|status)\b/;
/** What makes a command line more than the command it starts with: chaining, pipes, redirects, substitution. */
const SHELL_SYNTAX = /[;&|<>`$()\\\n\r]/;
/** git's own ways out of read-only: `grep -O<program>` (also `-iO`), `--open-files-in-pager` and `--output=<file>`. git takes shortened long options, hence the short prefixes. */
const WRITES_OR_RUNS = /(^|\s)(-[a-zA-Z0-9]*O|--op|--ou)/;

/** A read-only git command and nothing else. Refuses what it can't be sure of: an agent can run a harmless command another way. */
function isReadOnlyGit(cmd: string): boolean {
  return READ_GIT_CMD.test(cmd) && !SHELL_SYNTAX.test(cmd) && !WRITES_OR_RUNS.test(cmd.replace(/["']/g, ''));
}

function commandOf(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== 'object') return null;
  const o = rawInput as Record<string, unknown>;
  const raw = o.command ?? o.cmd;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) return (raw as string[]).join(' ');
  return null;
}

/**
 * Hunkdory's own rule for one of an agent's tool calls, whatever the agent asks permission for: read and
 * search are always fine; execute only for read-only git; edit-like calls only when the run allows editing;
 * everything else (fetch, switching modes, …) is refused rather than guessed at.
 */
export function decidePermission(access: Access, toolCall: { kind?: string | null; rawInput?: unknown }): 'allow' | 'reject' {
  const kind = toolCall.kind ?? 'other';
  if (kind === 'read' || kind === 'search') return 'allow';
  if (kind === 'execute') {
    const cmd = commandOf(toolCall.rawInput)?.trim();
    return cmd && isReadOnlyGit(cmd) ? 'allow' : 'reject';
  }
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return access === 'edit' ? 'allow' : 'reject';
  return 'reject';
}

/** Reads a file for an agent's fs/read_text_file, never leaving `cwd`: from disk when checked out there, else `git show <headRef>:<path>` when it isn't. */
export async function readTextFile(path: string, cwd: string, headRef: string | null | undefined, line?: number, limit?: number): Promise<string> {
  const rel = relative(cwd, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('That path is outside the session folder.');
  let content: string | null = null;
  if (!headRef && existsSync(path)) content = readFileSync(path, 'utf8');
  else if (headRef) content = await tryGit(['show', `${headRef}:${rel}`], cwd);
  if (content === null) throw new Error('No such file.');
  if (line || limit) {
    const lines = content.split('\n');
    const start = (line ?? 1) - 1;
    content = lines.slice(start, limit ? start + limit : undefined).join('\n');
  }
  return content;
}

type JsonRpcMessage = { jsonrpc?: '2.0'; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };

/**
 * A small JSON-RPC-over-stdio client for ACP's transport: newline-delimited JSON, one message per line, no
 * embedded newlines. Takes plain streams (not a ChildProcess) so tests can wire it to an in-memory fake
 * agent instead of a real subprocess.
 */
export class AcpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  private notificationHandlers = new Map<string, (params: unknown) => void>();
  private log: NodeJS.WritableStream | null = null;
  private closed = false;
  private output: Writable;

  constructor(input: Readable, output: Writable, logFile?: string) {
    this.output = output;
    if (logFile) {
      mkdirSync(dirname(logFile), { recursive: true });
      this.log = createWriteStream(logFile, { flags: 'a' });
    }
    createInterface({ input }).on('line', (line) => this.onLine(line));
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>) {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: (params: unknown) => void) {
    this.notificationHandlers.set(method, handler);
  }

  private write(msg: object) {
    if (this.closed) return;
    this.log?.write(`> ${JSON.stringify(msg)}\n`);
    this.output.write(`${JSON.stringify(msg)}\n`);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private async onLine(line: string) {
    if (!line.trim()) return;
    this.log?.write(`< ${line}\n`);
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // Stray non-protocol noise on stdout: ignore rather than crash the run.
    }
    if (msg.method !== undefined && msg.id !== undefined) {
      const handler = this.requestHandlers.get(msg.method);
      try {
        if (!handler) throw Object.assign(new Error('Method not found'), { code: -32601 });
        this.write({ jsonrpc: '2.0', id: msg.id, result: await handler(msg.params) });
      } catch (e) {
        this.write({ jsonrpc: '2.0', id: msg.id, error: { code: (e as { code?: number }).code ?? -32000, message: (e as Error).message } });
      }
      return;
    }
    if (msg.method !== undefined) {
      this.notificationHandlers.get(msg.method)?.(msg.params);
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  }

  close() {
    this.closed = true;
    this.log?.end();
    for (const { reject } of this.pending.values()) reject(new Error('Stopped.'));
    this.pending.clear();
  }
}

type ToolInfo = { kind?: string; rawInput?: unknown; title?: string };

/**
 * Runs one prompt turn over an already-connected AcpClient: initialize, session/new, session/prompt,
 * answering the agent's tool-call permission and file-read requests as it goes. Exported separately from
 * AcpAssistant so tests can drive it against an in-memory fake agent, without spawning a real process.
 */
export function runAcpTurn(client: AcpClient, opts: RunOptions, name: string): AssistantRun {
  let killed = false;
  let sessionId: string | null = null;
  const toolCalls = new Map<string, ToolInfo>();
  let text = '';

  client.onNotification('session/update', (params) => {
    const u = (params as { update?: Record<string, unknown> } | undefined)?.update;
    if (!u) return;
    if (u.sessionUpdate === 'agent_message_chunk') {
      const content = u.content as { type?: string; text?: string } | undefined;
      if (content?.type === 'text' && content.text) text += content.text;
    } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const id = u.toolCallId as string;
      const existing = toolCalls.get(id) ?? {};
      const info: ToolInfo = {
        kind: (u.kind as string | undefined) ?? existing.kind,
        rawInput: u.rawInput ?? existing.rawInput,
        title: (u.title as string | undefined) ?? existing.title,
      };
      toolCalls.set(id, info);
      if (info.title) opts.onActivity?.(info.title);
    }
  });

  client.onRequest('session/request_permission', async (params) => {
    const p = params as { toolCall: { toolCallId: string; kind?: string; rawInput?: unknown }; options: { optionId: string; kind: string }[] };
    const tracked = toolCalls.get(p.toolCall.toolCallId) ?? {};
    const outcome = decidePermission(opts.access, { kind: p.toolCall.kind ?? tracked.kind, rawInput: p.toolCall.rawInput ?? tracked.rawInput });
    const pick =
      outcome === 'allow' ? (p.options.find((o) => o.kind === 'allow_once') ?? p.options.find((o) => o.kind.startsWith('allow'))) : (p.options.find((o) => o.kind === 'reject_once') ?? p.options.find((o) => o.kind.startsWith('reject')));
    return { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } };
  });

  client.onRequest('fs/read_text_file', async (params) => {
    const p = params as { path: string; line?: number; limit?: number };
    return { content: await readTextFile(p.path, opts.cwd, opts.headRef, p.line, p.limit) };
  });

  const done = (async (): Promise<AssistantResult> => {
    await client.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'Hunkdory', version: '1' },
    });
    if (killed) throw new Error('Stopped.');
    const created = (await client.request('session/new', { cwd: opts.cwd, mcpServers: [] })) as { sessionId: string };
    sessionId = created.sessionId;
    const prompt = opts.schema ? `${opts.prompt}\n\nReply with ONLY a single JSON object (no markdown, no code fences, no commentary) matching this JSON schema:\n${JSON.stringify(opts.schema)}` : opts.prompt;
    const result = (await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] })) as { stopReason: string };
    if (killed) throw new Error('Stopped.');
    if (!text.trim() && result.stopReason !== 'end_turn') throw new Error(`${name} stopped without an answer (${result.stopReason}).`);
    return { text: text.trim(), structured: opts.schema ? parseStructured(text, opts.schema) : null };
  })();

  return {
    done,
    kill() {
      killed = true;
      if (sessionId) client.notify('session/cancel', { sessionId });
    },
  };
}

export class AcpAssistant implements Assistant {
  id: string;
  name: string;
  private command: string;
  private args: string[];

  constructor(config: AcpAgentConfig) {
    this.id = `acp:${config.id}`;
    this.name = config.name;
    this.command = config.command;
    this.args = config.args;
  }

  async available() {
    const bin = await which(this.command, await shellEnv());
    return bin ? { ok: true as const } : { ok: false as const, reason: `Could not find "${this.command}". Is ${this.name} installed?` };
  }

  async run(opts: RunOptions): Promise<AssistantRun> {
    const env = await agentEnv(pathOnlyEnv());
    const bin = await which(this.command, env);
    if (!bin) throw new Error(`Could not find "${this.command}". Is ${this.name} installed?`);
    const child = spawn(bin, this.args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), opts.timeoutMs);
    const client = new AcpClient(child.stdout, child.stdin, opts.logFile);
    const run = runAcpTurn(client, opts, this.name);

    const done = run.done.finally(() => {
      clearTimeout(timer);
      client.close();
      child.stdin.end();
      setTimeout(() => child.kill(), 2000).unref();
    });

    return {
      done,
      kill() {
        run.kill();
        child.kill();
      },
    };
  }

  async sendBack(_opts: SendBackOptions): Promise<SendBackHandle> {
    throw new Error(`${this.name} doesn't support sending a review back to a session yet.`);
  }
}
