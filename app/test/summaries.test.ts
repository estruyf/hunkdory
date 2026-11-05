import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { asOfNow, Summaries, type Summary } from '../src/main/summaries.ts';
import type { InboxScan } from '../src/main/projects.ts';
import type { InboxItem, Project, ProjectScan, ReviewState } from '../src/shared/types.ts';

const summary: Summary = { title: 'Add export', files: 3, added: 40, removed: 2, steps: 2, minutes: 3, flags: [], walkthrough: 'agent', author: null };
const file = () => join(mkdtempSync(join(tmpdir(), 'reviewer-summaries-')), 'inbox-summaries.json');

test('a summary is only returned for the fingerprint it was made for', () => {
  const s = new Summaries(file());
  s.set('p::feat/x', 'k1', summary);
  assert.deepEqual(s.get('p::feat/x', 'k1'), summary);
  assert.equal(s.get('p::feat/x', 'k2'), null);
  assert.equal(s.get('p::feat/y', 'k1'), null);
});

test('summaries survive a restart, and pruned branches are gone', async () => {
  const f = file();
  const s = new Summaries(f);
  s.set('p::feat/x', 'k1', summary);
  s.set('p::feat/y', 'k1', summary);
  s.keepOnly(new Set(['p::feat/x']));
  await sleep(600);
  const again = new Summaries(f);
  assert.deepEqual(again.get('p::feat/x', 'k1'), summary);
  assert.equal(again.get('p::feat/y', 'k1'), null);
});

test('an unreadable or older cache starts empty', () => {
  const broken = file();
  writeFileSync(broken, '{not json');
  assert.equal(new Summaries(broken).get('p::feat/x', 'k1'), null);
  const old = file();
  writeFileSync(old, JSON.stringify({ version: 0, entries: { 'p::feat/x': { key: 'k1', summary } } }));
  assert.equal(new Summaries(old).get('p::feat/x', 'k1'), null);
});

const scan = (over: Partial<InboxItem> = {}): InboxScan => ({
  items: [{ projectId: 'p', projectName: 'Old name', branch: 'feat/x', title: 'Add export', ignored: false, review: null, ...over } as InboxItem],
  scans: [{ projectId: 'p' }, { projectId: 'gone' }] as ProjectScan[],
  me: 'someone',
});
const project = (over: Partial<Project> = {}) => ({ id: 'p', name: 'New name', ...over }) as Project;
const state = (status: ReviewState['status'], reviewed: Record<string, string[]> = {}) => ({ status, reviewed }) as ReviewState;

test('the last inbox survives a restart, and an unreadable one is simply gone', async () => {
  const f = file();
  const s = new Summaries(f);
  assert.equal(s.lastScan, null);
  s.rememberScan(scan());
  await sleep(600);
  assert.deepEqual(new Summaries(f).lastScan, scan());
  writeFileSync(f, '{not json');
  assert.equal(new Summaries(f).lastScan, null);
});

test('a saved inbox follows what changed in Hunkdory since', () => {
  const none = () => null;
  assert.deepEqual(asOfNow(scan(), [], none).items, []);
  const now = asOfNow(scan(), [project({ ignored: ['feat/x'] })], (_, b) => (b === 'feat/x' ? state('open', { a: ['1'], b: ['2'] }) : null));
  assert.equal(now.items[0]!.projectName, 'New name');
  assert.equal(now.items[0]!.ignored, true);
  assert.deepEqual(now.items[0]!.review, { status: 'open', reviewedSteps: 2 });
  assert.deepEqual(now.scans.map((s) => s.projectId), ['p']);
  assert.equal(now.me, 'someone');
});

test('a review you finished after the scan leaves a saved inbox, and one that changed since stays', () => {
  for (const status of ['merged', 'discarded', 'reviewed'] as const) assert.deepEqual(asOfNow(scan(), [project()], () => state(status)).items, []);
  // Reviewed before that scan, and listed anyway: it changed after the review.
  const changed = scan({ review: { status: 'reviewed', reviewedSteps: 1 }, updatedSinceReview: true });
  assert.equal(asOfNow(changed, [project()], () => state('reviewed', { a: ['1'] })).items.length, 1);
});
