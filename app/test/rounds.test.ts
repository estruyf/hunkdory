import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinceLastRound } from '../src/shared/rounds.ts';
import { ignoreWhitespace, languageFor, splitRows } from '../src/shared/diff.ts';
import { githubReview, stepAnchor } from '../src/main/actions.ts';
import { apiComment } from '../src/main/github.ts';
import type { DecisionRecord, DiffLine, HunkView, Step } from '../src/shared/types.ts';

const step = (key: string, hunkIds: string[], index = 0): Step => ({ key, index, title: key, why: '', checks: [], risk: 'low', outsideTask: false, source: 'chapter', hunkIds, files: [`${key}.ts`], added: 1, removed: 0 });
const decision = (hunkIds?: string[]): DecisionRecord => ({ kind: 'send-back', note: '', dropStepKeys: [], at: '2026-10-28T10:00:00Z', result: 'ok', message: '', hunkIds });

test('no earlier round, nothing to compare', () => {
  assert.equal(sinceLastRound([step('a', ['1'])], { rounds: [] }), null);
});

test('each step is new, changed or the same as last round', () => {
  const steps = [step('same', ['1', '2']), step('changed', ['3', '9']), step('new', ['8'])];
  const r = sinceLastRound(steps, {
    rounds: [{ decision: decision(['1', '2', '3', '4']), reviewed: { same: ['1', '2'], changed: ['3'] }, comments: [{ id: 'c', stepKey: 'changed', hunkId: null, line: null, body: 'Rename this', createdAt: '' }] }],
  })!;
  assert.deepEqual(r.byStep, { same: 'same', changed: 'changed', new: 'new' });
  assert.equal(r.gone, 1, 'hunk 4 is no longer there');
  assert.deepEqual(r.alreadyReviewed.map((s) => s.key), ['same']);
  assert.equal(r.earlierComments.changed[0].body, 'Rename this');
});

test('older decisions without hunk ids fall back to what you reviewed', () => {
  const r = sinceLastRound([step('a', ['1'])], { rounds: [{ decision: decision(), reviewed: { a: ['1'] }, comments: [] }] })!;
  assert.equal(r.byStep.a, 'same');
});

const l = (kind: DiffLine['kind'], text: string, oldN: number | null, newN: number | null): DiffLine => ({ kind, text, oldN, newN });

test('side by side pairs removed lines with the added lines after them', () => {
  const rows = splitRows([l('ctx', 'a', 1, 1), l('del', 'b', 2, null), l('del', 'c', 3, null), l('add', 'B', null, 2), l('ctx', 'd', 4, 3), l('add', 'e', null, 4)]);
  assert.deepEqual(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null]), [['a', 'a'], ['b', 'B'], ['c', null], ['d', 'd'], [null, 'e']]);
});

test('hiding whitespace folds re-indented lines, and keeps real edits', () => {
  const out = ignoreWhitespace([l('del', '  if (x) {', 4, null), l('add', '    if (x) {', null, 4), l('del', 'a = 1', 5, null), l('add', 'a = 2', null, 5)]);
  assert.deepEqual(out.map((x) => [x.kind, x.text]), [['ctx', '    if (x) {'], ['del', 'a = 1'], ['add', 'a = 2']]);
  assert.deepEqual([out[0].oldN, out[0].newN], [4, 4]);
});

test('highlighting picks the language from the file name', () => {
  assert.equal(languageFor('src/app/page.tsx'), 'typescript');
  assert.equal(languageFor('Dockerfile'), 'dockerfile');
  assert.equal(languageFor('docs/notes.txt'), null);
});

test('a GitHub review puts line comments on lines and the rest in the text', () => {
  const steps = [step('auth', ['1'], 3), step('scratch', ['2'], 5)];
  const comments = [
    { id: '1', stepKey: 'auth', hunkId: '1', line: 4, path: 'src/auth.ts', side: 'RIGHT' as const, body: 'Keep it at an hour', createdAt: '' },
    { id: '2', stepKey: 'auth', hunkId: null, line: null, body: 'Why is this here?', createdAt: '' },
  ];
  const inline = githubReview({ steps }, { comments }, { note: 'Nearly there.', dropStepKeys: ['scratch'] }, { inline: true, copilot: false });
  assert.deepEqual(inline.comments, [{ path: 'src/auth.ts', line: 4, side: 'RIGHT', body: 'Keep it at an hour' }]);
  assert.match(inline.body, /^Nearly there\.\n\n\*\*Step 4: auth\*\* \(`auth\.ts`\)\nWhy is this here\?\n\nPlease drop these changes, they are outside the task:\n- Step 6: scratch \(`scratch\.ts`\)/);

  const folded = githubReview({ steps }, { comments }, { note: '', dropStepKeys: [] }, { inline: false, copilot: true });
  assert.deepEqual(folded.comments, []);
  assert.match(folded.body, /^@copilot Please address this review\.\n\n\*\*`src\/auth\.ts:4`\*\*\nKeep it at an hour/);
});

test('a GitHub review with nothing to say says who reviewed it', () => {
  const steps = [step('auth', ['1'], 3)];
  const empty = { note: '', dropStepKeys: [] };
  assert.deepEqual(githubReview({ steps }, { comments: [] }, empty, { inline: true, copilot: false, reviewer: 'eliostruyf' }), { body: 'Reviewed by eliostruyf in Hunkdory.', comments: [] });
  assert.equal(githubReview({ steps }, { comments: [] }, empty, { inline: true, copilot: false }).body, 'Reviewed in Hunkdory.');
  // With a summary, the summary is the text.
  assert.match(githubReview({ steps }, { comments: [] }, { note: 'LGTM', dropStepKeys: [] }, { inline: true, copilot: false, reviewer: 'eliostruyf' }).body, /^LGTM\n\n<sub>/);
});

const hunk = (id: string, path: string, lines: DiffLine[], extra: Partial<HunkView> = {}): HunkView => ({
  id, path, oldPath: null, status: 'modified', untracked: false, synthetic: null, bucket: 'narrated', level: 'none', risks: [],
  added: lines.filter((l) => l.kind === 'add').length, removed: lines.filter((l) => l.kind === 'del').length, rangeLabel: '', lines, note: null, ...extra,
});
const add = (n: number): DiffLine => ({ kind: 'add', oldN: null, newN: n, text: '' });
const del = (n: number): DiffLine => ({ kind: 'del', oldN: n, newN: null, text: '' });

test('a step comment goes on the step\'s first changed lines, as a range', () => {
  const s = { ...step('overview', ['a', 'b']), files: ['src/a.ts', 'src/b.ts'] };
  const hunks = { a: hunk('a', 'src/a.ts', [add(166), add(167), del(117), add(168)]), b: hunk('b', 'src/b.ts', [add(3)]) };
  const comments = [{ id: '1', stepKey: 'overview', hunkId: null, line: null, body: 'Not sure: does * catch it?', createdAt: '' }];
  const out = githubReview({ steps: [s], hunks }, { comments }, { note: '', dropStepKeys: [] }, { inline: true, copilot: false });
  assert.deepEqual(out.comments, [{ path: 'src/a.ts', line: 168, side: 'RIGHT', startLine: 166, startSide: 'RIGHT', body: '**Step 1: overview** (also `src/b.ts`)\n\nNot sure: does * catch it?' }]);
  assert.doesNotMatch(out.body, /Not sure/);
  assert.deepEqual(apiComment(out.comments[0]), { path: 'src/a.ts', line: 168, side: 'RIGHT', start_line: 166, start_side: 'RIGHT', body: out.comments[0].body });

  // Reviewed work GitHub doesn't have: in the text, as before.
  const folded = githubReview({ steps: [s], hunks }, { comments }, { note: '', dropStepKeys: [] }, { inline: false, copilot: false });
  assert.deepEqual(folded.comments, []);
  assert.match(folded.body, /\*\*Step 1: overview\*\* \(`src\/a\.ts`, `src\/b\.ts`\)\nNot sure/);
});

test('a step anchor skips files GitHub has no lines for, caps long blocks, and uses removed lines when nothing was added', () => {
  const big = Array.from({ length: 200 }, (_, i) => add(i + 1));
  assert.deepEqual(stepAnchor(step('s', ['u', 'n']), { u: hunk('u', 'new.ts', [add(1)], { untracked: true }), n: hunk('n', 'big.ts', big) }), { path: 'big.ts', line: 30, side: 'RIGHT', startLine: 1, startSide: 'RIGHT' });
  assert.deepEqual(stepAnchor(step('s', ['d']), { d: hunk('d', 'gone.ts', [del(7)]) }), { path: 'gone.ts', line: 7, side: 'LEFT' });
  assert.equal(stepAnchor(step('s', ['x']), {}), null);
});
