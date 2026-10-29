import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { askAbility, askPrompt, stepDiff, type AskInput } from '../src/main/conversations.ts';
import type { HunkView, SessionInfo } from '../src/shared/types.ts';

const hunk: HunkView = {
  id: '54b48929c1',
  path: 'src/auth/token.js',
  oldPath: null,
  status: 'modified',
  untracked: false,
  synthetic: null,
  bucket: 'narrated',
  level: 'high',
  risks: [],
  added: 1,
  removed: 1,
  rangeLabel: 'line 1',
  lines: [
    { kind: 'del', oldN: 1, newN: null, text: 'export const TOKEN_EXPIRY_SECONDS = 3600;' },
    { kind: 'add', oldN: null, newN: 1, text: 'export const TOKEN_EXPIRY_SECONDS = 86400;' },
    { kind: 'ctx', oldN: 2, newN: 2, text: '' },
  ],
  note: null,
};

const input = (extra: Partial<AskInput> = {}): AskInput => ({
  kind: 'question',
  text: 'Why a day?',
  by: 'fresh',
  step: { index: 3, title: 'Longer token expiry', why: 'Long syncs outlived the token.', files: ['src/auth/token.js'] },
  diff: stepDiff([hunk]),
  history: [],
  branch: 'agent',
  baseName: 'main',
  baseSha: 'abc123',
  headRef: 'refs/reviewer/pr/7',
  pr: { number: 7, title: 'Retry sync', body: 'Adds retries.' },
  prompt: null,
  wtvCommand: null,
  ...extra,
});

test('the step diff reads as a unified diff', () => {
  assert.equal(stepDiff([hunk]), '--- src/auth/token.js (line 1)\n-export const TOKEN_EXPIRY_SECONDS = 3600;\n+export const TOKEN_EXPIRY_SECONDS = 86400;\n ');
  assert.match(stepDiff([hunk, hunk], 3), /\[5 more lines cut off\]$/);
});

test('a fresh question gets the branch, the step and the question, and must not change files', () => {
  const p = askPrompt(input());
  assert.match(p, /reviewing the branch "agent", which goes into main/);
  assert.match(p, /git diff abc123 refs\/reviewer\/pr\/7/);
  assert.match(p, /## Pull request #7: Retry sync\nAdds retries\./);
  assert.match(p, /## The step: Longer token expiry\nLong syncs outlived the token\./);
  assert.match(p, /```diff\n--- src\/auth\/token\.js/);
  assert.match(p, /## The question\nWhy a day\?/);
  assert.match(p, /Don't change any files\./);
});

test('the agent that wrote the branch is told which step, not given the whole context again', () => {
  const p = askPrompt(input({ by: 'session-copy' }));
  assert.match(p, /^I'm reviewing your changes on this branch in Hunkdory, one step at a time\. I have a question about step 4 "Longer token expiry" \(src\/auth\/token\.js\)\./);
  assert.doesNotMatch(p, /Pull request #7|git diff abc123/);
  assert.match(p, /this is only a question/);
});

test('a change to a branch with its own walkthrough asks to keep it verified', () => {
  const p = askPrompt(input({ kind: 'change', by: 'session', text: 'Keep it at one hour.', wtvCommand: 'wtv verify' }));
  assert.match(p, /please make this change/);
  assert.match(p, /## The change\nKeep it at one hour\./);
  assert.match(p, /update \.review\/walkthrough\.json .* run `wtv verify` until it passes/);
  assert.match(p, /two or three sentences on what you changed/);
});

test('a fresh change edits the checkout without committing', () => {
  const p = askPrompt(input({ kind: 'change', headRef: null, text: 'Keep it at one hour.' }));
  assert.match(p, /checked out in the current folder/);
  assert.match(p, /## The change to make\nKeep it at one hour\./);
  assert.match(p, /Don't commit, and don't touch \.review\//);
});

test('follow-up questions carry the earlier ones', () => {
  const p = askPrompt(input({ history: [{ kind: 'question', text: 'Is this used elsewhere?', reply: 'Only in isExpired.' }] }));
  assert.match(p, /## Earlier on this step\nQuestion: Is this used elsewhere\?\nAnswer: Only in isExpired\./);
});

test('who can answer and change depends on the session and the checkout', () => {
  const dir = mkdtempSync(`${tmpdir()}/reviewer-`);
  const session = { cwd: dir } as SessionInfo;
  assert.deepEqual(askAbility(session, { checkout: { kind: 'none' }, pr: null }), { question: { by: 'session-copy' }, change: { by: 'session', where: dir } });
  assert.deepEqual(askAbility({ cwd: '/gone' } as SessionInfo, { checkout: { kind: 'worktree', path: '/wt' }, pr: null }), {
    question: { by: 'fresh' },
    change: { by: 'fresh', where: '/wt' },
  });
  const none = askAbility(null, { checkout: { kind: 'none' }, pr: null });
  assert.equal(none.question.by, 'fresh');
  assert.equal(none.change.by, null);
  assert.match((none.change as { reason: string }).reason, /isn't checked out on this Mac/);
});
