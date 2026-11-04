import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRunLog, readRunLog } from '../src/main/runLog.ts';

const lines = (...events: unknown[]) => events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n');

test("Claude Code's log reads as what it said and did, with the bookkeeping left out", () => {
  const raw = lines(
    { type: 'system', subtype: 'init', cwd: '/code/worktree', session_id: 's' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Fixing the cache.\n' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/code/worktree/src/cache.ts' } },
          { type: 'tool_use', name: 'TodoWrite', input: {} },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Fixing the cache.' }
  );
  assert.deepEqual(parseRunLog(raw, '/code/main'), [
    { kind: 'text', text: 'Fixing the cache.' },
    { kind: 'tool', text: 'Editing src/cache.ts' },
    { kind: 'tool', text: 'TodoWrite' },
  ]);
});

test("Copilot's log reads the same way", () => {
  const raw = lines(
    { type: 'session.start', data: {} },
    { type: 'assistant.message', data: { content: 'On it.', toolRequests: [{ name: 'view', arguments: { path: '/code/main/a.ts' } }] } },
    { type: 'result', exitCode: 0 }
  );
  assert.deepEqual(parseRunLog(raw, '/code/main'), [
    { kind: 'text', text: 'On it.' },
    { kind: 'tool', text: 'Reading a.ts' },
  ]);
});

test('a failed run says why, from the result or from what the CLI printed', () => {
  assert.deepEqual(parseRunLog(lines({ type: 'result', is_error: true, subtype: 'error_max_turns' }), '/p'), [{ kind: 'error', text: 'error_max_turns' }]);
  assert.deepEqual(parseRunLog(lines({ type: 'result', exitCode: 2 }), '/p'), [{ kind: 'error', text: 'The run stopped with exit code 2.' }]);
  assert.deepEqual(parseRunLog('No conversation found with session ID: s\n', '/p'), [{ kind: 'output', text: 'No conversation found with session ID: s' }]);
});

test('an event still being written is left for the next read', () => {
  const raw = lines({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }, '{"type":"assistant","mess');
  assert.deepEqual(parseRunLog(raw, '/p'), [{ kind: 'text', text: 'Done.' }]);
});

test('a very long log is read from its end, starting at a whole line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-runlog-'));
  try {
    const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    const short = join(dir, 'short.jsonl');
    writeFileSync(short, lines(say('All of it')));
    assert.deepEqual(await readRunLog(short, dir), { entries: [{ kind: 'text', text: 'All of it' }], cut: false });

    const long = join(dir, 'long.jsonl');
    writeFileSync(long, `${lines(say('x'.repeat(3 * 1024 * 1024)), say('The end'))}\n`);
    assert.deepEqual(await readRunLog(long, dir), { entries: [{ kind: 'text', text: 'The end' }], cut: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
