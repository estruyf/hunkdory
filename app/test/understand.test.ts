import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedSummary, names, reviewVerdict, reviewsSummary, threadCounts, trySummary, understandPages } from '../src/shared/understand.ts';
import type { GitHubFeedback, GitHubThread, HunkView, ReviewData, Step } from '../src/shared/types.ts';

const step = (i: number, over: Partial<Step> = {}): Step => ({
  key: `k${i}`, index: i, title: `Step ${i}`, why: '', checks: [], risk: 'low', riskNote: null, outsideTask: false, noTestChange: false, choices: [], behaviour: null, dependents: [], source: 'chapter',
  hunkIds: [`h${i}`], files: [`src/file${i}.ts`], added: 1, removed: 0, ...over,
});

const base = { steps: [step(0), step(1)], requested: [], diagram: null, background: null, tryIt: [], prompt: 'Add search' } satisfies Pick<ReviewData, 'steps' | 'requested' | 'diagram' | 'background' | 'tryIt' | 'prompt'>;

const hunk = (id: string, path: string, line: number): HunkView => ({
  id, path, oldPath: null, status: 'modified', untracked: false, synthetic: null, bucket: 'narrated', level: 'none', risks: [], added: 1, removed: 0, rangeLabel: '', note: null,
  lines: [{ kind: 'add', oldN: null, newN: line, text: 'x' }] as HunkView['lines'],
});

const thread = (id: string, over: Partial<GitHubThread> = {}): GitHubThread => ({
  id, path: 'src/a.ts', line: 11, startLine: null, side: 'RIGHT', resolved: false, outdated: false,
  comments: [{ id: `${id}c`, author: 'ana', body: 'Why?', at: '2026-11-01T00:00:00Z', url: 'https://x' }] as GitHubThread['comments'], ...over,
});

const hunks = { h0: hunk('h0', 'src/a.ts', 11) };

test('only the pages with something on them, in reading order', () => {
  assert.deepEqual(understandPages(base, null), []);
  const all = understandPages(
    {
      ...base,
      steps: [step(0, { behaviour: { before: 'a', after: 'b', example: null } }), step(1, { outsideTask: true })],
      background: 'Search goes through one API.',
      tryIt: [{ do: 'Search', expect: null }],
    },
    { reviews: [], threads: [thread('t1')] }
  );
  assert.deepEqual(all.map((p) => p.id), ['reviews', 'asked', 'fits', 'try']);
  assert.equal(all[3]!.title, 'What behaves differently, and how to try it');
  assert.equal(all[3]!.label, 'What behaves differently');
});

test('a PR without reviews or threads has no reviewers page, and a PR description is not "you"', () => {
  const pages = understandPages({ ...base, prompt: null, requested: [{ item: 'Search', status: 'done', stepKeys: ['k0'], note: null }] }, { reviews: [], threads: [] });
  assert.deepEqual(pages.map((p) => p.id), ['asked']);
  assert.equal(pages[0]!.title, 'What was asked, and what it did');
  assert.deepEqual(understandPages({ ...base, tryIt: [{ do: 'Run it', expect: null }] }, null).map((p) => p.title), ['How to try it']);
});

test('where the PR stands: changes requested over approvals over comments', () => {
  assert.deepEqual(reviewVerdict([]), { tone: 'muted', text: 'No reviews yet' });
  assert.deepEqual(reviewVerdict([{ login: 'bo', state: 'APPROVED' }, { login: 'ana', state: 'CHANGES_REQUESTED' }]), { tone: 'caution', text: 'Changes requested by ana' });
  assert.deepEqual(reviewVerdict([{ login: 'bo', state: 'APPROVED' }, { login: 'cy', state: 'APPROVED' }]), { tone: 'ok', text: 'Approved by bo and cy' });
  assert.equal(reviewVerdict([{ login: 'bo', state: 'COMMENTED' }]).text, 'Comments from bo');
  assert.equal(names(['a', 'b', 'c', 'd']), 'a, b and 2 more');
});

test('open threads split by whether a line of this diff shows them', () => {
  const feedback: GitHubFeedback = { reviews: [], threads: [thread('on'), thread('old', { line: null, outdated: true }), thread('done', { resolved: true })] };
  assert.deepEqual(threadCounts(feedback, hunks), { open: 2, onLine: 1, elsewhere: 1 });
  assert.deepEqual(threadCounts(null, hunks), { open: 0, onLine: 0, elsewhere: 0 });
});

test('the reviewers page sums up the reviews and where the threads are', () => {
  const review = (state: 'CHANGES_REQUESTED' | 'APPROVED' | 'COMMENTED') => ({ author: 'ana', state, body: '', at: '2026-11-01T00:00:00Z', url: `https://x/${state}` });
  assert.equal(reviewsSummary({ reviews: [review('CHANGES_REQUESTED')], threads: [thread('a'), thread('b', { line: null })] }, hunks), '1 review asks for changes. 2 threads are open: 1 on lines in this review, 1 not.');
  assert.equal(reviewsSummary({ reviews: [review('COMMENTED')], threads: [thread('a', { resolved: true })] }, hunks), '1 review, none asking for changes. Every thread is resolved.');
  assert.equal(reviewsSummary({ reviews: [], threads: [thread('a')] }, hunks), 'No reviews yet, only comments. 1 thread is open, all on lines in this review.');
});

test('the asked page counts what has code, and what nobody asked for', () => {
  const requested = [
    { item: 'A', status: 'done' as const, stepKeys: [], note: null },
    { item: 'B', status: 'done' as const, stepKeys: [], note: null },
    { item: 'C', status: 'partly' as const, stepKeys: [], note: null },
  ];
  assert.equal(askedSummary({ ...base, requested, steps: [step(0), step(1, { outsideTask: true, files: ['a.json', 'b.ts'] })] }), '2 of 3 asks have code. One is only partly there. It also changed 2 files you didn’t ask about.');
  assert.equal(askedSummary({ ...base, requested: [requested[0]!] }), 'The one ask has code.');
});

test('the behaviour page says how many steps change it, and how to try it', () => {
  const changed = step(0, { behaviour: { before: 'a', after: 'b', example: null } });
  assert.equal(trySummary({ ...base, steps: [changed], tryIt: [{ do: 'x', expect: null }, { do: 'y', expect: null }] }), '1 step changes how it behaves. Then try it in 2 steps to see it working.');
  assert.equal(trySummary({ ...base, tryIt: [{ do: 'x', expect: null }] }), 'Try it in 1 step to see it working.');
});
