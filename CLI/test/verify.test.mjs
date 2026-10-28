import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.mjs';
import { verify, loadWalkthrough } from '../src/verify.mjs';

const bin = fileURLToPath(new URL('../bin/wtv.mjs', import.meta.url));
const wtv = (cwd, args, input) => spawnSync(process.execPath, [bin, ...args], { cwd, input, encoding: 'utf8' });
const wtPath = (dir) => join(dir, '.review/walkthrough.json');

test('flags what the agent did not mention', () => {
  const { dir } = buildFixture();
  const r = verify({ cwd: dir, walkthrough: loadWalkthrough(wtPath(dir)) });
  const unnarrated = r.buckets.unnarrated.map((id) => r.byId.get(id));

  assert.equal(r.ok, false);
  assert.deepEqual(unnarrated.map((h) => h.path).sort(), ['scratch.js', 'src/auth/token.js', 'test/sync.test.js']);
  assert.equal(r.byId.get(r.buckets.unnarrated[0]).level, 'high');
  assert.ok(unnarrated.find((h) => h.path === 'test/sync.test.js').risks.some((x) => x.code === 'tests-weakened'));
  assert.ok(unnarrated.find((h) => h.path === 'scratch.js').untracked);
});

test('ignores pure reformatting and reports phantom claims', () => {
  const { dir } = buildFixture();
  const r = verify({ cwd: dir, walkthrough: loadWalkthrough(wtPath(dir)) });
  assert.deepEqual(r.buckets.noise.map((id) => r.byId.get(id).path), ['src/format.js']);
  assert.deepEqual(r.buckets.phantom.map((p) => p.ref), ['src/sync/backoff.js']);
});

test('--head only checks committed changes', () => {
  const { dir } = buildFixture();
  const r = verify({ cwd: dir, walkthrough: loadWalkthrough(wtPath(dir)), head: 'HEAD' });
  assert.ok(!r.hunks.some((h) => h.path === 'scratch.js'));
});

test('hunk ids are stable across a rebase-like line shift', () => {
  const { dir } = buildFixture();
  const before = verify({ cwd: dir, walkthrough: loadWalkthrough(wtPath(dir)) });
  const moved = before.hunks.find((h) => h.path === 'test/sync.test.js');
  const file = join(dir, 'test/sync.test.js');
  writeFileSync(file, `// header comment\n// another one\n${readFileSync(file, 'utf8')}`);
  execFileSync('git', ['commit', '-qam', 'shift lines'], { cwd: dir });
  const after = verify({ cwd: dir, walkthrough: loadWalkthrough(wtPath(dir)) });
  const same = after.hunks.find((h) => h.id === moved.id);
  assert.ok(same, 'same change keeps the same id after moving down');
  assert.equal(same.newStart, moved.newStart + 2);
});

test('passes once every hunk is explained', () => {
  const { dir } = buildFixture();
  const wt = JSON.parse(readFileSync(wtPath(dir), 'utf8'));
  const list = JSON.parse(wtv(dir, ['list', '--json']).stdout);
  const id = (path) => `h:${list.hunks.find((h) => h.path === path).id}`;
  wt.chapters[0].hunks = ['src/retry.js'];
  wt.chapters.push(
    { title: 'Longer tokens', why: 'Users were logged out mid-sync', hunks: [id('src/auth/token.js')] },
    { title: 'Drop flaky assertion', why: 'Order is no longer guaranteed with retries', hunks: [id('test/sync.test.js')] },
    { title: 'Debug script', why: 'Manual check, will delete', hunks: ['scratch.js'] }
  );
  writeFileSync(wtPath(dir), JSON.stringify(wt));
  const res = wtv(dir, ['verify']);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /PASS/);
});

test('exit codes and json output', () => {
  const { dir } = buildFixture();
  assert.equal(wtv(dir, ['verify']).status, 1);
  const json = JSON.parse(wtv(dir, ['verify', '--json']).stdout);
  assert.equal(json.ok, false);
  assert.equal(json.buckets.unnarrated.length, 3);
  assert.equal(wtv(dir, ['verify', '--nope']).status, 2);
});

test('hook mode blocks once, then lets the agent stop', () => {
  const { dir } = buildFixture();
  const first = wtv(dir, ['verify', '--hook'], JSON.stringify({ cwd: dir, stop_hook_active: false }));
  assert.equal(first.status, 2);
  assert.match(first.stderr, /unnarrated/);
  const second = wtv(dir, ['verify', '--hook'], JSON.stringify({ cwd: dir, stop_hook_active: true }));
  assert.equal(second.status, 0);
});

test('hook mode never blocks outside a git repo', () => {
  const res = wtv('/', ['verify', '--hook', '--cwd', '/'], '{}');
  assert.equal(res.status, 0);
});

test('init writes a skeleton covering every real hunk', () => {
  const { dir } = buildFixture();
  const res = wtv(dir, ['init', '--force']);
  assert.equal(res.status, 0, res.stderr);
  const v = wtv(dir, ['verify', '--json']);
  const json = JSON.parse(v.stdout);
  assert.equal(json.buckets.unnarrated.length, 0);
  assert.ok(json.findings.some((f) => f.code === 'missing-why'));
});
