import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastRead, readReview, rememberReadState } from '../src/renderer/state/reviewReads.ts';
import { jobKey, useWalkthroughs } from '../src/renderer/state/walkthroughs.ts';
import type { ReviewData, ReviewState, WalkthroughJob } from '../src/shared/types.ts';

const state = (projectId: string, branch: string, title = 'first') => ({ projectId, branch, title }) as ReviewState;
const read = (projectId: string, branch: string, walkthrough: ReviewData['walkthrough'] = 'reviewer') => ({ data: { projectId, branch, walkthrough } as ReviewData, state: state(projectId, branch) });

Object.assign(globalThis, { window: { api: { loadReview: async (projectId: string, branch: string) => read(projectId, branch) } } });

test('a branch that was never read has nothing to show', () => {
  assert.equal(lastRead('p', 'never'), null);
});

test('coming back shows the last read, with your newest state', async () => {
  await readReview('p', 'a');
  assert.equal(lastRead('p', 'a')?.state.title, 'first');
  rememberReadState(state('p', 'a', 'newer'));
  assert.equal(lastRead('p', 'a')?.state.title, 'newer');
  // State for a branch that isn't remembered doesn't make it one.
  rememberReadState(state('p', 'not-read'));
  assert.equal(lastRead('p', 'not-read'), null);
});

test('one step per file is not worth showing once the walkthrough is done', async () => {
  const api = (globalThis as unknown as { window: { api: { loadReview: unknown } } }).window.api;
  const before = api.loadReview;
  api.loadReview = async () => read('p', 'skeleton', 'skeleton');
  await readReview('p', 'skeleton');
  api.loadReview = before;
  const job = (status: WalkthroughJob['status']) => useWalkthroughs.setState({ jobs: { [jobKey('p', 'skeleton')]: { status } as WalkthroughJob } });
  job('running');
  assert.ok(lastRead('p', 'skeleton'));
  job('done');
  assert.equal(lastRead('p', 'skeleton'), null);
  useWalkthroughs.setState({ jobs: {} });
});

test('only the most recent reads are kept', async () => {
  await readReview('old', 'x');
  for (let i = 0; i < 10; i++) await readReview('p', `b${i}`);
  assert.equal(lastRead('old', 'x'), null);
  assert.ok(lastRead('p', 'b9'));
  // Reading one again makes it recent.
  await readReview('p', 'b0');
  await readReview('p', 'new');
  assert.ok(lastRead('p', 'b0'));
  assert.equal(lastRead('p', 'b1'), null);
});
