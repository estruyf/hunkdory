import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copilotArgs, describeTool, parseCopilotLine, parseStructured, READ_GIT_SHELL } from '../src/main/assistants/copilot.ts';

// Slice 3 of docs/plans/2026-11-02-assistants.md: `copilot -p … --output-format json` events, recorded live
// (see the probe notes in the plan) and saved under test/fixtures/copilot-*.jsonl. Every event line here
// came from a real `copilot` run; these tests check Hunkdory's event parsing and argument building against
// what the CLI actually sends, not a guess at its shape.

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', `${name}.jsonl`), 'utf8').trim().split('\n');

test('copilotArgs: git-only allows read-only git over bash, nothing else', () => {
  assert.deepEqual(copilotArgs({ access: 'git-only', sessionId: 's1', prompt: 'p' }), [
    '-p', 'p', '--output-format', 'json', '--session-id', 's1', '--name', 'Hunkdory: question',
    '--no-custom-instructions', '--disable-builtin-mcps', '--no-auto-update', '--no-ask-user',
    '--available-tools', 'bash', '--allow-tool', ...READ_GIT_SHELL,
  ]);
});

test('copilotArgs: read adds view, grep and glob', () => {
  assert.deepEqual(copilotArgs({ access: 'read', sessionId: 's1', prompt: 'p' }), [
    '-p', 'p', '--output-format', 'json', '--session-id', 's1', '--name', 'Hunkdory: question',
    '--no-custom-instructions', '--disable-builtin-mcps', '--no-auto-update', '--no-ask-user',
    '--available-tools', 'bash', 'view', 'grep', 'glob', '--allow-tool', ...READ_GIT_SHELL, 'view', 'grep', 'glob',
  ]);
});

test('copilotArgs: edit adds edit and create tools, allows writing, and names the run "change"', () => {
  assert.deepEqual(copilotArgs({ access: 'edit', sessionId: 's1', prompt: 'p' }), [
    '-p', 'p', '--output-format', 'json', '--session-id', 's1', '--name', 'Hunkdory: change',
    '--no-custom-instructions', '--disable-builtin-mcps', '--no-auto-update', '--no-ask-user',
    '--available-tools', 'bash', 'view', 'grep', 'glob', 'edit', 'create', '--allow-tool', ...READ_GIT_SHELL, 'view', 'grep', 'glob', 'write',
  ]);
});

test('copilotArgs: a schema (walkthroughs only) names the run "walkthrough"', () => {
  const args = copilotArgs({ access: 'read', sessionId: 's1', prompt: 'p', schema: { type: 'object' } });
  assert.equal(args[args.indexOf('--name') + 1], 'Hunkdory: walkthrough');
});

test('copilotArgs: resuming a linked session continues it with --resume, no --session-id, and allows writing', () => {
  assert.deepEqual(copilotArgs({ access: 'edit', sessionId: 'unused', prompt: 'keep going', session: { mode: 'continue', id: 'real-session-id' }, allowBash: ['shell(wtv *)'] }), [
    '--resume', 'real-session-id', '-p', 'keep going', '--output-format', 'json',
    '--available-tools', 'bash', 'view', 'grep', 'glob', 'edit', 'create',
    '--allow-tool', ...READ_GIT_SHELL, 'view', 'grep', 'glob', 'write', 'shell(wtv *)',
    '--no-custom-instructions', '--disable-builtin-mcps', '--no-auto-update', '--no-ask-user',
  ]);
});

test("describeTool: Copilot's own tool names, same wording as Claude's", () => {
  assert.equal(describeTool('bash', { command: 'git show refs/reviewer/pr/1:src/a.ts' }, '/r'), 'Reading src/a.ts');
  assert.equal(describeTool('bash', { command: 'git log --oneline' }, '/r'), 'git log --oneline');
  assert.equal(describeTool('view', { path: '/r/src/c.ts' }, '/r'), 'Reading src/c.ts');
  assert.equal(describeTool('grep', { pattern: 'register' }, '/r'), 'Searching for "register"');
  assert.equal(describeTool('glob', { pattern: '**/*.ts' }, '/r'), 'Looking for **/*.ts');
  assert.equal(describeTool('edit', { path: '/r/a.txt' }, '/r'), 'Editing a.txt');
  assert.equal(describeTool('create', { path: '/r/new.txt' }, '/r'), 'Editing new.txt');
  assert.equal(describeTool('session.info', {}, '/r'), null);
});

test('a read-only run: the final message is the answer, the bash call is the only activity', () => {
  const cwd = '/private/tmp/copilot-probe';
  let text: string | undefined;
  const activities: string[] = [];
  for (const line of fixture('copilot-read-events')) {
    const parsed = parseCopilotLine(line, cwd);
    if (!parsed) continue;
    if (parsed.text) text = parsed.text;
    activities.push(...parsed.activities);
  }
  assert.equal(text, 'The file a.txt contains the text "hello world".');
  assert.deepEqual(activities, ['cat a.txt']);
});

test('an edit run: activity covers both the bash check and the edit itself', () => {
  const cwd = '/private/tmp/copilot-probe';
  const activities: string[] = [];
  let text: string | undefined;
  for (const line of fixture('copilot-edit-events')) {
    const parsed = parseCopilotLine(line, cwd);
    if (!parsed) continue;
    if (parsed.text) text = parsed.text;
    activities.push(...parsed.activities);
  }
  assert.equal(text, 'Appended "done" to the end of a.txt.');
  assert.deepEqual(activities, ['cat /private/tmp/copilot-probe/a.txt 2>/dev/null || echo "NOEXIST"', 'Editing a.txt']);
});

test('view, grep and glob all produce activity lines, from one run that used all three', () => {
  const cwd = '/private/tmp/copilot-probe';
  const activities: string[] = [];
  for (const line of fixture('copilot-view-grep-glob-events')) {
    const parsed = parseCopilotLine(line, cwd);
    if (parsed) activities.push(...parsed.activities);
  }
  assert.deepEqual(activities, ['Reading a.txt', 'Searching for "hello"', 'Looking for **/*.txt']);
});

test('a denied tool still reports the exit code from the final result event', () => {
  const cwd = '/private/tmp/copilot-probe';
  let exitCode: number | null | undefined;
  for (const line of fixture('copilot-denied-tool-events')) {
    const parsed = parseCopilotLine(line, cwd);
    if (parsed && typeof parsed.exitCode !== 'undefined') exitCode = parsed.exitCode;
  }
  assert.equal(exitCode, 0); // the run itself succeeds; it's the one tool call that was refused
});

test('parseStructured: a JSON reply is parsed and checked against the schema', () => {
  const schema = { type: 'object', required: ['title', 'steps'], properties: { title: { type: 'string' }, steps: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } };
  const [line] = fixture('copilot-json-reply-events').filter((l) => l.includes('"type":"assistant.message"')).slice(-1);
  const parsed = parseCopilotLine(line, '/r');
  assert.ok(parsed?.text);
  const out = parseStructured(parsed.text, schema);
  assert.equal(out.title, 'Add a README file');
  assert.equal((out.steps as unknown[]).length, 2);
});

test('parseStructured: rejects a reply missing a required field, with a message pointing at it', () => {
  assert.throws(() => parseStructured('{"title": "x"}', { type: 'object', required: ['title', 'steps'] }), /missing "steps"/);
});

test('parseStructured: strips a ```json fence Copilot adds despite being asked not to', () => {
  const out = parseStructured('```json\n{"title": "x"}\n```', { type: 'object', required: ['title'] });
  assert.equal(out.title, 'x');
});

test('parseStructured: a reply that is not JSON at all fails clearly', () => {
  assert.throws(() => parseStructured('Sure, here you go: not actually JSON', { type: 'object' }), /didn't reply with valid JSON/);
});
