import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Summaries, type Summary } from '../src/main/summaries.ts';

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
