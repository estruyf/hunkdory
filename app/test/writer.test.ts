import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../../tools/wtv/test/fixture.mjs';
import { normalizeWalkthrough, verify } from '../../tools/wtv/src/verify.mjs';
import { buildSteps } from '../src/main/steps.ts';
import { GeneratedWalkthroughs, WALKTHROUGH_SCHEMA, writerPrompt, type WriterInput } from '../src/main/writer.ts';
import { describeTool } from '../src/main/claudeRun.ts';
import type { HunkView } from '../src/shared/types.ts';

const hunk = (id: string, path: string, extra: Partial<HunkView> = {}): HunkView => ({
  id,
  path,
  oldPath: null,
  status: 'modified',
  untracked: false,
  synthetic: null,
  bucket: 'narrated',
  level: 'none',
  risks: [],
  added: 2,
  removed: 1,
  rangeLabel: 'lines 3–4',
  lines: [],
  note: null,
  ...extra,
});

const input = (extra: Partial<WriterInput> = {}): WriterInput => ({
  branch: 'fix/2187-registrations-feedback',
  baseName: 'develop/5.5',
  baseSha: 'abc123',
  headRef: 'refs/reviewer/pr/2187',
  pr: { number: 2187, title: 'fix(propertytagger): registrations feedback', body: 'Fixes the feedback form.' },
  prompt: null,
  commits: ['Fix form', 'Add test'],
  hunks: [
    hunk('54b48929c1', 'src/auth/token.js', { level: 'high', risks: [{ code: 'auth', severity: 'high', label: 'Touches auth or security' }] }),
    hunk('f5bee72e04', 'test/sync.test.js'),
    hunk('aaaaaaaaaa', 'package-lock.json', { bucket: 'generated' }),
    hunk('bbbbbbbbbb', 'src/format.js', { bucket: 'noise' }),
  ],
  ...extra,
});

test('the prompt lists every hunk to cover by id, with its risks, and leaves out formatting and generated files', () => {
  const p = writerPrompt(input());
  assert.match(p, /h:54b48929c1 {2}src\/auth\/token\.js {2}lines 3–4 {2}\+2 -1 {2}\[Touches auth or security\]/);
  assert.match(p, /h:f5bee72e04/);
  assert.doesNotMatch(p, /h:aaaaaaaaaa|h:bbbbbbbbbb/);
  assert.match(p, /The 2 hunks to cover/);
  assert.match(p, /2 more hunk\(s\) are whitespace-only or generated/);
  assert.match(p, /Pull request #2187: fix\(propertytagger\): registrations feedback\nFixes the feedback form\./);
  assert.match(p, /- Fix form\n- Add test/);
  assert.match(p, /`title` names the change like a pull request title: under 70 characters/);
});

test('the run must return a short title next to the intent', () => {
  assert.deepEqual(WALKTHROUGH_SCHEMA.required, ['title', 'intent', 'chapters']);
});

test('a branch without a checkout is read through git only', () => {
  const p = writerPrompt(input());
  assert.match(p, /files on disk belong to another branch/);
  assert.match(p, /git diff abc123 refs\/reviewer\/pr\/2187/);
  assert.match(p, /git show refs\/reviewer\/pr\/2187:<path>/);
});

test('a checked-out branch includes uncommitted work', () => {
  const p = writerPrompt(input({ headRef: null }));
  assert.match(p, /checked out in the current folder, including uncommitted and untracked files/);
  assert.match(p, /git diff abc123`/);
  assert.doesNotMatch(p, /belong to another branch/);
});

test('outsideTask only makes sense when someone stated a task', () => {
  assert.match(writerPrompt(input()), /Set `outsideTask: true`/);
  assert.match(writerPrompt(input({ pr: null })), /no stated request, so leave `outsideTask` out/);
  assert.match(writerPrompt(input({ pr: null, prompt: 'Fix the form' })), /What the author asked their agent for\nFix the form/);
});

test('the second attempt gets what the first one missed', () => {
  const previous = { intent: 'x', chapters: [{ title: 'Auth', why: 'y', hunks: ['h:54b48929c1', 'src/gone.js'] }] };
  const p = writerPrompt(input(), { previous, missing: [input().hunks[1]], phantom: [{ title: 'Auth', ref: 'src/gone.js' }] });
  assert.match(p, /These hunks are in no chapter[^\n]*\nh:f5bee72e04/);
  assert.match(p, /These refs match no hunk[^\n]*\n- "Auth": src\/gone\.js/);
  assert.ok(p.includes(JSON.stringify(previous, null, 2)));
});

test('after a change on the branch, the walkthrough is updated rather than written again', () => {
  const previous = { intent: 'x', chapters: [{ title: 'Auth', why: 'y', hunks: ['h:0000000000'] }] };
  const p = writerPrompt(input(), { previous, missing: [input().hunks[0]], phantom: [{ title: 'Auth', ref: 'h:0000000000' }], changed: true });
  assert.match(p, /## Update the existing walkthrough\nThe branch changed[^\n]*Keep chapter titles and order where they still fit/);
  assert.doesNotMatch(p, /Fix your first attempt/);
  assert.match(p, /These hunks are in no chapter[^\n]*\nh:54b48929c1/);
  assert.match(p, /These refs match no hunk any more[^\n]*\n- "Auth": h:0000000000/);
  assert.ok(p.includes(JSON.stringify(previous, null, 2)));
});

test('tool calls become short progress lines', () => {
  assert.equal(describeTool('Bash', { command: 'git show refs/reviewer/pr/1:src/a.ts' }, '/r'), 'Reading src/a.ts');
  assert.equal(describeTool('Bash', { command: 'git diff abc def -- src/b.ts' }, '/r'), 'Reading src/b.ts');
  assert.equal(describeTool('Bash', { command: 'git log --oneline' }, '/r'), 'git log --oneline');
  assert.equal(describeTool('Bash', { command: 'cd /tmp/x && git log --oneline' }, '/r'), 'git log --oneline');
  assert.equal(describeTool('Read', { file_path: '/r/src/c.ts' }, '/r'), 'Reading src/c.ts');
  assert.equal(describeTool('Grep', { pattern: 'register' }, '/r'), 'Searching for "register"');
  assert.equal(describeTool('StructuredOutput', {}, '/r'), null);
});

test('generated walkthroughs are kept per branch, outside the repo', () => {
  const store = new GeneratedWalkthroughs(join(mkdtempSync(join(tmpdir(), 'reviewer-')), 'walkthroughs'));
  assert.equal(store.read('p1', 'feature/a'), null);
  store.write('p1', 'feature/a', { chapters: [] });
  assert.deepEqual(JSON.parse(store.read('p1', 'feature/a')!), { chapters: [] });
  assert.equal(store.read('p1', 'feature/b'), null);
  assert.equal(store.read('p2', 'feature/a'), null);
});

test("hunks Hunkdory's walkthrough misses are labelled as such, not blamed on an agent", () => {
  const { dir } = buildFixture();
  const wt = normalizeWalkthrough({ intent: 'Retries', chapters: [{ title: 'Retry helper', why: 'Sync failed on flaky networks.', hunks: ['src/retry.js'] }] });
  const { byId: _b, ...r } = verify({ cwd: dir, walkthrough: wt, base: undefined, head: undefined });
  const steps = buildSteps(r as unknown as WtvResult, 'reviewer');
  assert.equal(steps[0].source, 'chapter');
  const missed = steps.filter((s) => s.source === 'unnarrated');
  assert.ok(missed.length > 0);
  for (const s of missed) assert.match(s.why, /walkthrough Hunkdory wrote doesn't cover/);
});
