import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildsOn, duplicateBranches } from '../src/main/match.ts';
import { formatDuration, suggestedOrder, tooBig } from '../src/shared/order.ts';

const item = (name: string, over: Partial<Parameters<typeof suggestedOrder>[0][number]> = {}) => ({ name, minutes: 20, steps: 10, updatedSinceReview: false, updatedAt: '2026-10-28T10:00:00Z', review: null, checks: [], ...over });

test('a branch on the same commit as another folds into it, never a PR', () => {
  const dups = duplicateBranches([
    { name: 'perf/flicker', headSha: 'a', pr: true, dirty: false },
    { name: 'worktree-fuzzy-otter', headSha: 'a', pr: false, dirty: false },
    { name: 'feat/x', headSha: 'b', pr: false, dirty: false },
    { name: 'worktree-x-copy', headSha: 'b', pr: false, dirty: true },
  ]);
  assert.deepEqual([...dups], [['worktree-fuzzy-otter', 'perf/flicker']]);
  // Without a PR, the named branch stays and the auto-named worktree goes.
  assert.deepEqual([...duplicateBranches([{ name: 'worktree-a', headSha: 'c', pr: false, dirty: false }, { name: 'fix/a', headSha: 'c', pr: false, dirty: false }])], [['worktree-a', 'fix/a']]);
});

test('a branch that contains another inbox branch builds on it', () => {
  const heads = [{ name: 'perf/flicker', headSha: 'a' }, { name: 'perf/flicker-fixes', headSha: 'c' }, { name: 'feat/y', headSha: 'd' }];
  const unique = new Map([['perf/flicker', new Set(['a'])], ['perf/flicker-fixes', new Set(['a', 'b', 'c'])], ['feat/y', new Set(['d'])]]);
  assert.deepEqual([...buildsOn(heads, unique)], [['perf/flicker-fixes', 'perf/flicker']]);
});

test('the suggested order: started, updated, small to large with failing CI later, too big last', () => {
  const list = [
    item('huge', { minutes: 900, steps: 290 }),
    item('small-failing', { minutes: 5, checks: [{ state: 'fail' }] }),
    item('medium', { minutes: 45 }),
    item('small', { minutes: 10 }),
    item('updated', { minutes: 60, updatedSinceReview: true }),
    item('started', { minutes: 300, review: { status: 'open', reviewedSteps: 2 } }),
  ];
  assert.deepEqual(suggestedOrder(list).map((w) => w.name), ['started', 'updated', 'small', 'medium', 'small-failing', 'huge']);
});

test('durations read as minutes, then hours', () => {
  assert.equal(formatDuration(19), '19 min');
  assert.equal(formatDuration(271), '5 h');
  assert.equal(formatDuration(927), '15 h');
  assert.equal(tooBig({ minutes: 46, steps: 12 }), false);
  assert.equal(tooBig({ minutes: 271, steps: 51 }), true);
});
