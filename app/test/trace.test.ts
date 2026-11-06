import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeBranchEvents, claudeEvents, copilotEvents, readSessionDigest, readStepTrace, sessionDigest, stepTurns } from '../src/main/sessions/trace.ts';
import { jsonl } from './fixtures/transcript.ts';
import type { SessionInfo } from '../src/shared/types.ts';

const prompt = (content: string, at = '2026-10-21T10:00:00.000Z') => ({ type: 'user', timestamp: at, message: { content } });
const said = (text: string, at = '2026-10-21T10:01:00.000Z') => ({ type: 'assistant', timestamp: at, message: { content: [{ type: 'text', text }] } });
const edit = (id: string, file_path: string, name = 'Edit', at = '2026-10-21T10:02:00.000Z') => ({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id, name, input: { file_path } }] } });
const failed = (id: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'String not found' }] } });

test("finds the edits to a step's files, in any worktree, with the prompt and what the agent said just before", () => {
  const events = claudeEvents(
    jsonl([
      prompt('Add retries'),
      said('Looking around.'),
      said('A plain loop is enough here.'),
      edit('1', '/code/.claude/worktrees/x/src/retry.ts'),
      edit('2', '/code/src/other.ts'),
      edit('3', '/code/.claude/worktrees/x/src/retry.ts', 'Write'),
      prompt('Now the docs', '2026-10-21T11:00:00.000Z'),
      edit('4', '/code/README.md'),
    ])
  );
  assert.deepEqual(stepTurns(events, ['src/retry.ts']), [
    {
      prompt: 'Add retries',
      subagent: false,
      at: '2026-10-21T10:02:00.000Z',
      entries: [
        { kind: 'text', text: 'A plain loop is enough here.' },
        { kind: 'tool', text: 'Edited src/retry.ts (2 times)' },
      ],
    },
  ]);
});

test('a file matches on whole path parts, and an edit that failed is not part of the change', () => {
  const events = claudeEvents(jsonl([prompt('Go'), edit('1', '/code/xsrc/a.ts'), edit('2', '/code/src/a.ts'), failed('2')]));
  assert.deepEqual(stepTurns(events, ['src/a.ts']), []);
});

test('a new turn for each prompt that edits the file', () => {
  const events = claudeEvents(jsonl([prompt('First'), edit('1', '/c/a.ts'), prompt('Second'), edit('2', '/c/a.ts')]));
  assert.deepEqual(stepTurns(events, ['a.ts']).map((t) => t.prompt), ['First', 'Second']);
});

test("the session's own transcript leaves out subagent records, and a subagent's file keeps its task", () => {
  const side = (r: object) => ({ ...r, isSidechain: true });
  const raw = jsonl([side(prompt('Fix the parser')), side(edit('1', '/c/a.ts'))]);
  assert.deepEqual(stepTurns(claudeEvents(raw), ['a.ts']), []);
  assert.deepEqual(stepTurns(claudeEvents(raw, true), ['a.ts'], true).map((t) => [t.prompt, t.subagent]), [['Fix the parser', true]]);
});

test('reads a real Copilot session', () => {
  const events = copilotEvents(readFileSync(join(import.meta.dirname, 'fixtures/copilot-edit-events.jsonl'), 'utf8'));
  const turns = stepTurns(events, ['copilot-probe/a.txt']);
  assert.equal(turns.length, 1);
  assert.ok(turns[0].prompt);
  assert.match(turns[0].entries.at(-1)!.text, /^Edited copilot-probe\/a\.txt/);
});

const session = (over: Partial<SessionInfo>): SessionInfo => ({
  id: 's',
  file: '/nope.jsonl',
  agent: 'claude-code',
  configDir: null,
  cwd: '/c',
  branches: [],
  originalBranch: null,
  worktreePath: null,
  firstPrompt: null,
  title: null,
  startedAt: null,
  endedAt: null,
  testRuns: [],
  lastEditAt: null,
  ...over,
});

test("reads a session and its subagents' files, oldest first, and an unreadable one only costs context", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'));
  const file = join(dir, 's.jsonl');
  writeFileSync(file, jsonl([{ ...prompt('Main'), gitBranch: 'feat/b' }, { ...edit('1', '/c/a.ts', 'Edit', '2026-10-21T10:05:00.000Z'), gitBranch: 'feat/b' }]));
  mkdirSync(join(dir, 's', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 's', 'subagents', 'agent-1.jsonl'), jsonl([{ ...prompt('Sub'), isSidechain: true, gitBranch: 'feat/b' }, { ...edit('2', '/c/a.ts', 'Edit', '2026-10-21T10:01:00.000Z'), isSidechain: true, gitBranch: 'feat/b' }]));
  const turns = await readStepTrace([session({ file }), session({ id: 'gone' })], ['a.ts'], { branch: 'feat/b', baseName: 'main' });
  assert.deepEqual(turns.map((t) => t.prompt), ['Sub', 'Main']);
});

test('the digest has what was asked, said and thought, without the edits, and keeps the end when it is too long', async () => {
  const thought = { type: 'assistant', timestamp: 't', message: { content: [{ type: 'thinking', thinking: 'Redis or memory?' }, { type: 'thinking', thinking: '' }] } };
  const digest = sessionDigest(claudeEvents(jsonl([prompt('Add a cache'), thought, said('Using memory.'), edit('1', '/c/a.ts')])));
  assert.equal(digest, 'Asked: Add a cache\n\nAgent, thinking: Redis or memory?\n\nAgent: Using memory.');

  const long = sessionDigest(Array.from({ length: 40 }, (_, i) => ({ kind: 'said' as const, text: `${i} ${'x'.repeat(3000)}`, at: null })));
  assert.match(long, /^\[earlier part left out\]/);
  assert.match(long, /\[cut off\]$/);
  assert.ok(long.length < 31_000);
  assert.ok(long.includes('Agent: 39 '), 'the end stays');
  assert.ok(!long.includes('Agent: 0 '), 'the start goes');
});

const on = (gitBranch: string, r: object) => ({ ...r, gitBranch });
const saidOn = (gitBranch: string, text: string) => on(gitBranch, said(text));
const texts = (raw: string, branch = 'feat/b', base = 'main') =>
  claudeBranchEvents(raw, branch, (n) => !n || n === base || n.startsWith('worktree-')).flatMap((e) => (e.kind === 'said' ? [e.text] : []));

test('a branch keeps its own work and leaves out what the session did on other branches', () => {
  const raw = jsonl([saidOn('feat/a', 'Work on a'), saidOn('main', 'Back on main'), saidOn('feat/b', 'Work on b'), saidOn('feat/c', 'Work on c'), saidOn('feat/b', 'More on b')]);
  assert.deepEqual(texts(raw), ['Back on main', 'Work on b', 'More on b']);
});

test('reasons from before the branch existed stay, on the base or in a new worktree, but not on another feature', () => {
  assert.deepEqual(texts(jsonl([saidOn('main', 'Plan on main'), saidOn('feat/b', 'Commit')])), ['Plan on main', 'Commit']);
  assert.deepEqual(texts(jsonl([saidOn('worktree-brave-otter', 'Plan in the worktree'), saidOn('feat/b', 'Commit')])), ['Plan in the worktree', 'Commit']);
  assert.deepEqual(texts(jsonl([saidOn('feat/a', 'Other feature'), saidOn('feat/b', 'Commit')])), ['Commit']);
  assert.deepEqual(texts(jsonl([saidOn('main', 'Long before'), saidOn('feat/a', 'Other feature'), saidOn('feat/b', 'Commit')])), ['Commit'], 'only what leads straight in');
});

test('a subagent or a rebase does not split the stretch on a branch', () => {
  const raw = jsonl([saidOn('feat/b', 'One'), { ...saidOn('elsewhere', 'Subagent'), isSidechain: true }, saidOn('HEAD', 'Mid rebase'), saidOn('feat/b', 'Two')]);
  assert.deepEqual(texts(raw), ['One', 'Mid rebase', 'Two']);
});

test("the digest only reads sessions the writing assistant ran, and only this branch's part of them", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'digest-'));
  const claude = join(dir, 'claude.jsonl');
  writeFileSync(claude, jsonl([saidOn('feat/a', 'Other work'), saidOn('main', 'Plan'), saidOn('feat/b', 'Commit')]));
  const copilot = join(dir, 'events.jsonl');
  writeFileSync(copilot, jsonl([{ type: 'assistant.message', timestamp: 't', data: { content: 'From Copilot' } }]));
  const sessions = [session({ file: claude, startedAt: '1' }), session({ file: copilot, agent: 'copilot', startedAt: '2' })];
  const scope = { branch: 'feat/b', baseName: 'main' };

  assert.equal(await readSessionDigest(sessions, { ...scope, assistantId: 'claude-code' }), 'Agent: Plan\n\nAgent: Commit');
  assert.equal(await readSessionDigest(sessions, { ...scope, baseName: 'origin/main', assistantId: 'claude-code' }), 'Agent: Plan\n\nAgent: Commit', 'sessions record the local name of a base on origin');
  assert.equal(await readSessionDigest(sessions, { ...scope, assistantId: 'copilot' }), 'Agent: From Copilot', 'Copilot sessions have no branches to filter on');
  assert.equal(await readSessionDigest(sessions, { ...scope, assistantId: 'acp:gemini' }), null, 'an ACP agent gets none');
  assert.equal(await readSessionDigest([session({})], { ...scope, assistantId: 'claude-code' }), null, 'an unreadable transcript only costs context');
});

test("the trace leaves out edits to the same file on another branch, from the session and its subagents", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'));
  const file = join(dir, 's.jsonl');
  const editOn = (gitBranch: string, id: string, extra = {}) => ({ ...edit(id, '/c/a.ts'), gitBranch, ...extra });
  const askOn = (gitBranch: string, text: string, extra = {}) => ({ ...prompt(text), gitBranch, ...extra });
  writeFileSync(file, jsonl([askOn('feat/a', 'Other feature'), editOn('feat/a', '1'), askOn('main', 'Plan'), editOn('main', '2'), askOn('feat/b', 'This feature'), editOn('feat/b', '3')]));
  mkdirSync(join(dir, 's', 'subagents'), { recursive: true });
  const side = { isSidechain: true };
  writeFileSync(join(dir, 's', 'subagents', 'agent-1.jsonl'), jsonl([askOn('feat/a', 'Other subagent', side), editOn('feat/a', '4', side)]));
  writeFileSync(join(dir, 's', 'subagents', 'agent-2.jsonl'), jsonl([askOn('feat/b', 'This subagent', side), editOn('feat/b', '5', side)]));
  writeFileSync(join(dir, 's', 'subagents', 'agent-3.jsonl'), jsonl([askOn('worktree-agent-x', 'Worktree subagent', side), editOn('worktree-agent-x', '6', side)]));

  const turns = await readStepTrace([session({ file })], ['a.ts'], { branch: 'feat/b', baseName: 'main' });
  assert.deepEqual(turns.map((t) => t.prompt).sort(), ['Plan', 'This feature', 'This subagent', 'Worktree subagent']);
});

test("a Copilot session's trace stays whole: it doesn't record branches", async () => {
  const file = join(import.meta.dirname, 'fixtures/copilot-edit-events.jsonl');
  const turns = await readStepTrace([session({ file, agent: 'copilot' })], ['copilot-probe/a.txt'], { branch: 'feat/b', baseName: 'main' });
  assert.equal(turns.length, 1);
});

test("a session's own worktree or start branch counts as lead-up", async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'digest-')), 's.jsonl');
  writeFileSync(file, jsonl([saidOn('develop', 'Plan on the start branch'), saidOn('feat/b', 'Commit')]));
  const digest = await readSessionDigest([session({ file, originalBranch: 'develop' })], { assistantId: 'claude-code', branch: 'feat/b', baseName: 'main' });
  assert.equal(digest, 'Agent: Plan on the start branch\n\nAgent: Commit');
});
