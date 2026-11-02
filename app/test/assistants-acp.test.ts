import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AcpClient, decidePermission, readTextFile, runAcpTurn } from '../src/main/assistants/acp.ts';
import { assistantFor } from '../src/main/assistants/index.ts';
import type { RunOptions } from '../src/main/assistants/types.ts';

function gitRepo(): string {
  const dir = mkdtempSync(`${tmpdir()}/acp-`);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'base.txt'), 'line one\nline two\nline three\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

/** Two AcpClients wired together over in-memory streams: one plays the client under test, the other a scripted fake agent. */
function pair(): [AcpClient, AcpClient] {
  const toAgent = new PassThrough();
  const toClient = new PassThrough();
  return [new AcpClient(toClient, toAgent), new AcpClient(toAgent, toClient)];
}

const baseOpts = (extra: Partial<RunOptions> = {}): RunOptions => ({
  cwd: '/tmp',
  prompt: 'Explain this.',
  access: 'read',
  session: null,
  logFile: `${mkdtempSync(`${tmpdir()}/acp-log-`)}/run.jsonl`,
  timeoutMs: 5000,
  ...extra,
});

test('decidePermission: read and search are always allowed', () => {
  assert.equal(decidePermission('read', { kind: 'read' }), 'allow');
  assert.equal(decidePermission('read', { kind: 'search' }), 'allow');
  assert.equal(decidePermission('git-only', { kind: 'read' }), 'allow');
});

test('decidePermission: execute is only allowed for read-only git commands', () => {
  assert.equal(decidePermission('read', { kind: 'execute', rawInput: { command: 'git diff HEAD' } }), 'allow');
  assert.equal(decidePermission('read', { kind: 'execute', rawInput: { command: 'git show main:a.ts' } }), 'allow');
  assert.equal(decidePermission('read', { kind: 'execute', rawInput: { command: ['git', 'log', '-1'] } }), 'allow');
  assert.equal(decidePermission('read', { kind: 'execute', rawInput: { command: 'git commit -am oops' } }), 'reject');
  assert.equal(decidePermission('read', { kind: 'execute', rawInput: { command: 'rm -rf /' } }), 'reject');
  assert.equal(decidePermission('read', { kind: 'execute', rawInput: {} }), 'reject');
});

test('decidePermission: edit-like calls need edit access', () => {
  assert.equal(decidePermission('edit', { kind: 'edit' }), 'allow');
  assert.equal(decidePermission('edit', { kind: 'delete' }), 'allow');
  assert.equal(decidePermission('edit', { kind: 'move' }), 'allow');
  assert.equal(decidePermission('read', { kind: 'edit' }), 'reject');
  assert.equal(decidePermission('git-only', { kind: 'delete' }), 'reject');
});

test('decidePermission: anything else (fetch, switching modes, think, unknown) is refused', () => {
  assert.equal(decidePermission('edit', { kind: 'fetch' }), 'reject');
  assert.equal(decidePermission('edit', { kind: 'think' }), 'reject');
  assert.equal(decidePermission('edit', { kind: 'switch_mode' }), 'reject');
  assert.equal(decidePermission('edit', {}), 'reject');
});

test('readTextFile reads from disk when the path is checked out, and refuses paths outside cwd', async () => {
  const dir = mkdtempSync(`${tmpdir()}/acp-fs-`);
  writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n');
  assert.equal(await readTextFile(join(dir, 'a.txt'), dir, null), 'hello\nworld\n');
  assert.equal(await readTextFile(join(dir, 'a.txt'), dir, null, 2, 1), 'world');
  await assert.rejects(readTextFile('/etc/passwd', dir, null), /outside the session folder/);
  await assert.rejects(readTextFile(join(dir, 'missing.txt'), dir, null), /No such file/);
});

test('readTextFile falls back to `git show <headRef>:<path>` when the path isn\'t checked out there', async () => {
  const dir = gitRepo();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
  // Not checked out at this ref's content under a different name: read it through git instead of disk.
  assert.equal(await readTextFile(join(dir, 'base.txt'), dir, head), 'line one\nline two\nline three\n');
  await assert.rejects(readTextFile(join(dir, 'nope.txt'), dir, head), /No such file/);
});

test('runAcpTurn: initializes, starts a session, prompts, and resolves with the streamed text', async () => {
  const [client, agent] = pair();
  agent.onRequest('initialize', async () => ({ protocolVersion: 1, agentCapabilities: {} }));
  agent.onRequest('session/new', async () => ({ sessionId: 'sess-1' }));
  agent.onRequest('session/prompt', async (params) => {
    const p = params as { sessionId: string };
    agent.notify('session/update', { sessionId: p.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'read', title: 'Reading src/a.ts' } });
    agent.notify('session/update', { sessionId: p.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It renames a function.' } } });
    return { stopReason: 'end_turn' };
  });

  const activity: string[] = [];
  const run = runAcpTurn(client, baseOpts({ onActivity: (a) => activity.push(a) }), 'Fake Agent');
  const out = await run.done;
  assert.equal(out.text, 'It renames a function.');
  assert.deepEqual(activity, ['Reading src/a.ts']);
});

test('runAcpTurn: a schema run parses the streamed JSON into structured output', async () => {
  const [client, agent] = pair();
  agent.onRequest('initialize', async () => ({}));
  agent.onRequest('session/new', async () => ({ sessionId: 's' }));
  agent.onRequest('session/prompt', async (params) => {
    const p = params as { sessionId: string };
    agent.notify('session/update', { sessionId: p.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"title":"Retry sync","chapters":[]}' } } });
    return { stopReason: 'end_turn' };
  });

  const schema = { type: 'object', required: ['title', 'chapters'], properties: { title: { type: 'string' }, chapters: { type: 'array' } } };
  const run = runAcpTurn(client, baseOpts({ schema }), 'Fake Agent');
  const out = await run.done;
  assert.deepEqual(out.structured, { title: 'Retry sync', chapters: [] });
});

test('runAcpTurn: approves a read-only git execute call, and rejects an edit when access is read', async () => {
  const [client, agent] = pair();
  const decisions: string[] = [];
  agent.onRequest('initialize', async () => ({}));
  agent.onRequest('session/new', async () => ({ sessionId: 's' }));
  agent.onRequest('session/prompt', async (params) => {
    const p = params as { sessionId: string };
    const ask = async (toolCallId: string, kind: string, rawInput?: unknown) => {
      const res = (await agent.request('session/request_permission', {
        sessionId: p.sessionId,
        toolCall: { toolCallId, kind, rawInput },
        options: [
          { optionId: 'allow', kind: 'allow_once' },
          { optionId: 'reject', kind: 'reject_once' },
        ],
      })) as { outcome: { outcome: string; optionId?: string } };
      decisions.push(res.outcome.optionId ?? res.outcome.outcome);
    };
    await ask('t1', 'execute', { command: 'git show main:a.ts' });
    await ask('t2', 'edit', { path: 'a.ts' });
    return { stopReason: 'end_turn' };
  });

  const run = runAcpTurn(client, baseOpts({ access: 'read' }), 'Fake Agent');
  await run.done;
  assert.deepEqual(decisions, ['allow', 'reject']);
});

test('runAcpTurn: serves fs/read_text_file from disk, honouring the cwd boundary', async () => {
  const dir = mkdtempSync(`${tmpdir()}/acp-fs-run-`);
  writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n');
  const [client, agent] = pair();
  let content = '';
  agent.onRequest('initialize', async () => ({}));
  agent.onRequest('session/new', async () => ({ sessionId: 's' }));
  agent.onRequest('session/prompt', async () => {
    const res = (await agent.request('fs/read_text_file', { sessionId: 's', path: join(dir, 'a.ts') })) as { content: string };
    content = res.content;
    return { stopReason: 'end_turn' };
  });

  const run = runAcpTurn(client, baseOpts({ cwd: dir }), 'Fake Agent');
  await run.done;
  assert.equal(content, 'export const x = 1;\n');
});

test('runAcpTurn: a refusal with no text surfaces the stop reason as an error', async () => {
  const [client, agent] = pair();
  agent.onRequest('initialize', async () => ({}));
  agent.onRequest('session/new', async () => ({ sessionId: 's' }));
  agent.onRequest('session/prompt', async () => ({ stopReason: 'refusal' }));
  const run = runAcpTurn(client, baseOpts(), 'Fake Agent');
  await assert.rejects(run.done, /Fake Agent stopped without an answer \(refusal\)/);
});

test('an acp:<id> project id resolves to Claude Code when no such agent is configured', () => {
  assert.equal(assistantFor({ assistant: 'acp:unknown' }).id, 'claude-code');
});
