import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { belongsTo, claudeConfigDirs, encodeProjectPath, parseTranscript, promptText, readSessions, sessionDirsFor, testResult } from '../src/main/sessions/claude.ts';
import { jsonl, lines, ROOT, SESSION, WT } from './fixtures/transcript.ts';

test('encodes project paths the way Claude Code names its folders', () => {
  assert.equal(encodeProjectPath('/Users/dev/acme-api'), '-Users-dev-acme-api');
  assert.equal(encodeProjectPath('/Users/dev/acme-api/.claude/worktrees/brave-otter'), '-Users-dev-acme-api--claude-worktrees-brave-otter');
  assert.equal(encodeProjectPath('/tmp/my_app v2'), '-tmp-my-app-v2');
});

test('parses branches, worktree origin, title and the first real prompt', () => {
  const s = parseTranscript(jsonl(lines), '/x.jsonl', SESSION)!;
  assert.equal(s.id, SESSION);
  assert.equal(s.cwd, WT);
  assert.equal(s.worktreePath, WT);
  assert.equal(s.originalBranch, 'dev');
  assert.equal(s.title, 'Rate limiting');
  assert.equal(s.firstPrompt, 'Add rate limiting to the public API. Per API key, return a proper 429.');
  assert.deepEqual(s.branches.map((b) => b.name), ['worktree-brave-otter', 'feat/rate-limit']);
  assert.equal(s.branches[1].lastSeen, '2026-10-21T16:30:00.000Z');
  assert.equal(s.branches[1].firstSeen, '2026-10-21T16:20:00.000Z');
  assert.equal(s.startedAt, '2026-10-21T16:10:00.000Z');
  assert.equal(s.endedAt, '2026-10-21T16:30:00.000Z');
});

test('ignores subagent turns for cwd and branches', () => {
  const s = parseTranscript(jsonl(lines), '/x.jsonl', SESSION)!;
  assert.ok(!s.branches.some((b) => b.name === 'sidechain-branch'));
  assert.notEqual(s.cwd, '/elsewhere');
});

test('falls back to a bare slash command when nothing else was typed', () => {
  const only = lines.filter((l) => !(l as { promptSource?: string }).promptSource || (l as { promptSource?: string }).promptSource === 'typed');
  const s = parseTranscript(jsonl(only), '/x.jsonl', SESSION)!;
  assert.equal(s.firstPrompt, '/init');
});

test('survives a partial last line and skips files without a conversation', () => {
  const s = parseTranscript(`${jsonl(lines)}\n{"type":"user","mess`, '/x.jsonl', SESSION);
  assert.ok(s);
  assert.equal(parseTranscript(jsonl([{ type: 'ai-title', aiTitle: 'x', sessionId: SESSION }]), '/x.jsonl', SESSION), null);
});

test('promptText handles the record shapes Claude Code writes', () => {
  const user = (content: unknown, extra = {}) => ({ type: 'user', message: { content }, ...extra });
  assert.deepEqual(promptText(user('Fix the bug')), { text: 'Fix the bug', slashOnly: false });
  assert.deepEqual(
    promptText(user('<command-message>brag</command-message>\n<command-name>/brag</command-name>\n<command-args>about 1.2</command-args>')),
    { text: '/brag about 1.2', slashOnly: false }
  );
  assert.equal(promptText(user('[Request interrupted by user]')), null);
  assert.equal(promptText(user('<task-notification>x</task-notification>')), null);
  assert.equal(promptText(user([{ type: 'tool_result', content: 'x' }])), null);
  assert.equal(promptText(user('hi', { isMeta: true })), null);
  assert.equal(promptText(user('hi', { isSidechain: true })), null);
  assert.equal(promptText(user('hi', { promptSource: 'system' })), null);
  assert.equal(promptText(user([{ type: 'text', text: '<system-reminder>ctx</system-reminder>' }])), null);
  assert.equal(promptText({ type: 'assistant', message: { content: 'hi' } }), null);
});

test('finds session folders for a repo and its worktrees, and confirms by cwd', () => {
  const config = mkdtempSync(join(tmpdir(), 'reviewer-sessions-'));
  const dir = join(config, 'projects');
  mkdirSync(dir);
  const main = join(dir, encodeProjectPath(ROOT));
  const wt = join(dir, encodeProjectPath(WT));
  const other = join(dir, encodeProjectPath(`${ROOT}-legacy`)); // same prefix, different repo
  for (const d of [main, wt, other]) mkdirSync(d);
  writeFileSync(join(wt, `${SESSION}.jsonl`), jsonl(lines));
  const legacy = lines.map((l) => ('cwd' in l ? { ...l, cwd: `${ROOT}-legacy` } : l)).filter((l) => (l as { type?: string }).type !== 'worktree-state');
  writeFileSync(join(other, 'legacy.jsonl'), jsonl(legacy));

  const dirs = sessionDirsFor([ROOT], [config]);
  assert.deepEqual(dirs.sort(), [main, other, wt].sort(), 'prefix match is loose on purpose');
  const sessions = readSessions(dirs).filter((s) => belongsTo(s, [ROOT]));
  assert.deepEqual(sessions.map((s) => s.id), [SESSION], 'the cwd check drops the other repo');
  assert.equal(sessions[0].configDir, config, 'remembers which config dir to resume from');
});

test('looks in every Claude Code config dir, not just ~/.claude', () => {
  const home = mkdtempSync(join(tmpdir(), 'reviewer-home-'));
  for (const d of ['.claude/projects', '.claude-work/projects', '.claude-test', 'custom/projects', '.claudeish/projects']) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, '.claude.json'), '{}');
  assert.deepEqual(claudeConfigDirs(home, {}), [join(home, '.claude'), join(home, '.claude-work')], 'only dirs with a projects folder, and not .claude.json');
  assert.deepEqual(claudeConfigDirs(home, { CLAUDE_CONFIG_DIR: '~/custom' }), [join(home, '.claude'), join(home, 'custom'), join(home, '.claude-work')]);
});

test('test runs come from Bash calls and their output, and the last edit is kept', () => {
  const at = (m: number) => `2026-10-21T17:${String(m).padStart(2, '0')}:00.000Z`;
  const use = (m: number, id: string, name: string, input: object) => ({ type: 'assistant', cwd: WT, sessionId: SESSION, timestamp: at(m), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const result = (m: number, id: string, content: string, isError = false) => ({ type: 'user', cwd: WT, sessionId: SESSION, timestamp: at(m), toolUseResult: { stdout: content }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
  const s = parseTranscript(
    jsonl([
      ...lines,
      use(1, 'e1', 'Edit', { file_path: '/x.ts' }),
      use(2, 'b1', 'Bash', { command: 'cd /repo && npm test 2>&1 | tail -3' }),
      result(3, 'b1', ' Tests  1 failed | 28 passed (29)'),
      use(4, 'b2', 'Bash', { command: 'node --disable-warning=X --test test/*.test.ts' }),
      result(5, 'b2', 'ℹ pass 66\nℹ fail 0'),
      use(6, 'b3', 'Bash', { command: 'grep -rn "vitest" src' }),
      result(7, 'b3', 'src/a.ts: vitest'),
      use(6, 'b4', 'Bash', { command: "python3 - <<'EOF'\nprint('npm test')\nEOF" }),
      result(7, 'b4', 'npm test'),
      use(8, 'e2', 'Write', { file_path: '/y.ts' }),
    ]),
    '/x.jsonl',
    SESSION
  )!;
  assert.deepEqual(s.testRuns, [
    { command: 'npm test 2>&1 | tail -3', result: 'failed', at: at(2) },
    { command: 'node --disable-warning=X --test test/*.test.ts', result: 'passed', at: at(4) },
  ]);
  assert.equal(s.lastEditAt, at(8));
});

test('a test result reads the output, since a piped run exits 0', () => {
  assert.equal(testResult(false, 'Tests:       32 passed, 32 total'), 'passed');
  assert.equal(testResult(false, '0 failed, 12 passed'), 'passed');
  assert.equal(testResult(false, '✖ failing tests:'), 'failed');
  assert.equal(testResult(true, ''), 'failed');
  assert.equal(testResult(false, 'built in 76ms'), 'unknown');
});
