import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { belongsTo, parseCopilotEvents, parseCopilotSession, parseWorkspaceYaml, readCopilotSessions } from '../src/main/sessions/copilot.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const workspaceYaml = readFileSync(join(FIXTURES, 'copilot-session-workspace.yaml'), 'utf8');
const eventsJsonl = readFileSync(join(FIXTURES, 'copilot-session-events.jsonl'), 'utf8');

test('parseWorkspaceYaml reads the flat key: value lines Copilot writes, quotes and all', () => {
  const meta = parseWorkspaceYaml(workspaceYaml);
  assert.equal(meta.id, '09e6fbf3-2ee2-49c8-86d6-3328c519b463');
  assert.equal(meta.cwd, '/private/tmp/copilot-slice4');
  assert.equal(meta.branch, 'feature');
  assert.equal(meta.name, 'what is in a.txt?');
  assert.equal(meta.created_at, '2026-11-02T13:54:14.754Z');
});

test('parseWorkspaceYaml unquotes a single-quoted value with a colon in it', () => {
  const meta = parseWorkspaceYaml("id: x\nname: 'say: hello, world'\ncwd: /y\ncreated_at: 2026-01-01T00:00:00.000Z\n");
  assert.equal(meta.name, 'say: hello, world');
});

test("parseCopilotEvents finds the first user message, a test run, and the last edit's time", () => {
  const parsed = parseCopilotEvents(eventsJsonl);
  assert.equal(parsed.firstPrompt, 'what is in a.txt?');
  assert.ok(parsed.lastEditAt, 'the fixture has two edit tool calls');
});

test('parseCopilotEvents pairs a bash tool call with its result for test-run detection', () => {
  const at = (m: number) => `2026-11-02T13:54:${String(m).padStart(2, '0')}.000Z`;
  const start = (id: string, command: string, time: number) => JSON.stringify({ type: 'tool.execution_start', timestamp: at(time), data: { toolCallId: id, toolName: 'bash', arguments: { command } } });
  const complete = (id: string, content: string, time: number, success = true) =>
    JSON.stringify({ type: 'tool.execution_complete', timestamp: at(time), data: { toolCallId: id, toolName: 'bash', success, result: { content } } });
  const events = [
    JSON.stringify({ type: 'user.message', timestamp: at(0), data: { content: 'run the tests' } }),
    start('b1', 'cd /repo && npm test', 10),
    complete('b1', 'ℹ pass 12\nℹ fail 0', 11),
  ].join('\n');
  const parsed = parseCopilotEvents(events);
  assert.deepEqual(parsed.testRuns, [{ command: 'npm test', result: 'passed', at: at(10) }]);
});

test('parseCopilotSession builds a SessionInfo from workspace.yaml + events.jsonl, tagged as copilot', () => {
  const s = parseCopilotSession('09e6fbf3', workspaceYaml, eventsJsonl, '/x/events.jsonl')!;
  assert.equal(s.agent, 'copilot');
  assert.equal(s.configDir, null);
  assert.equal(s.cwd, '/private/tmp/copilot-slice4');
  assert.deepEqual(s.branches, [], "Copilot doesn't record which branches a session ran on");
  assert.equal(s.firstPrompt, 'what is in a.txt?');
  assert.equal(s.title, 'what is in a.txt?');
  assert.equal(s.startedAt, '2026-11-02T13:54:14.754Z');
  assert.equal(s.endedAt, '2026-11-02T13:54:38.084Z');
});

test('parseCopilotSession is null without a usable workspace.yaml', () => {
  assert.equal(parseCopilotSession('x', 'not: yaml-ish\n', '', '/x/events.jsonl'), null, 'missing cwd/created_at');
});

test('readCopilotSessions finds every session folder, skips dotfiles like lock folders, and belongsTo confirms the cwd', () => {
  const base = mkdtempSync(join(tmpdir(), 'reviewer-copilot-'));
  const id = '09e6fbf3-2ee2-49c8-86d6-3328c519b463';
  const dir = join(base, id);
  mkdirSync(dir);
  writeFileSync(join(dir, 'workspace.yaml'), workspaceYaml);
  writeFileSync(join(dir, 'events.jsonl'), eventsJsonl);
  mkdirSync(join(base, '.session-operation-locks'));
  writeFileSync(join(base, '.session-operation-locks', `${id}.lock`), '');

  const sessions = readCopilotSessions(base);
  assert.equal(sessions.length, 1, 'the lock folder is not a session');
  assert.equal(sessions[0].id, id);
  assert.ok(belongsTo(sessions[0], ['/private/tmp/copilot-slice4']));
  assert.ok(!belongsTo(sessions[0], ['/somewhere/else']));
});
