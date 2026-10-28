import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinceLastRound } from '../src/shared/rounds.ts';
import { ignoreWhitespace, languageFor, splitRows } from '../src/shared/diff.ts';
import { githubReview } from '../src/main/actions.ts';
import type { DecisionRecord, DiffLine, Step } from '../src/shared/types.ts';

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
