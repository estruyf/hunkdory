import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantFor, ASSISTANTS } from '../src/main/assistants/index.ts';
import { ManualAssistant } from '../src/main/assistants/manual.ts';

test('a project with no assistant set, or "claude-code", uses Claude Code', () => {
  assert.equal(assistantFor().id, 'claude-code');
  assert.equal(assistantFor({ assistant: 'claude-code' }).id, 'claude-code');
  assert.equal(assistantFor(null).id, 'claude-code');
});

test('a project set to Manual gets the Manual assistant', () => {
  assert.equal(assistantFor({ assistant: 'manual' }).id, 'manual');
});

test('a project set to Copilot gets the Copilot assistant', () => {
  assert.equal(assistantFor({ assistant: 'copilot' }).id, 'copilot');
});

test('every assistant Hunkdory can be connected to is listed, Claude Code before Manual', () => {
  assert.deepEqual(ASSISTANTS.map((a) => a.id), ['claude-code', 'copilot', 'manual']);
});

test('Manual is always available: it has no CLI to find', async () => {
  const r = await new ManualAssistant().available();
  assert.deepEqual(r, { ok: true });
});

test('Manual never runs anything', async () => {
  const m = new ManualAssistant();
  await assert.rejects(m.run({ cwd: '/r', prompt: 'p', access: 'read', session: null, logFile: '/tmp/x.jsonl', timeoutMs: 1000 }), /set to Manual/);
  await assert.rejects(m.sendBack({ session: { id: 's', cwd: '/r' }, prompt: 'p', logFile: '/tmp/x.jsonl', allowBash: [] }), /set to Manual/);
});
