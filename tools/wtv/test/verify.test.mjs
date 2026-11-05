import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.mjs';
import { verify, loadWalkthrough, normalizeWalkthrough } from '../src/verify.mjs';

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

test('passes through checks, outsideTask and agent notes', () => {
  const { dir } = buildFixture();
  const wt = JSON.parse(readFileSync(wtPath(dir), 'utf8'));
  const list = JSON.parse(wtv(dir, ['list', '--json']).stdout);
  const tokenId = `h:${list.hunks.find((h) => h.path === 'src/auth/token.js').id}`;
  wt.chapters.push({
    title: 'Longer tokens',
    why: 'Users were logged out mid-sync',
    checks: ['Is a day too long for a token?'],
    outsideTask: true,
    hunks: [tokenId],
    notes: { [tokenId]: 'I raised this while testing.', 'src/retry.js': 'Not in this chapter.' },
  });
  writeFileSync(wtPath(dir), JSON.stringify(wt));
  const json = JSON.parse(wtv(dir, ['verify', '--json']).stdout);
  const ch = json.chapters.at(-1);
  assert.deepEqual(ch.checks, ['Is a day too long for a token?']);
  assert.equal(ch.outsideTask, true);
  assert.deepEqual(ch.notes[0], { ref: tokenId, text: 'I raised this while testing.', hunkIds: [tokenId.slice(2)] });
  assert.deepEqual(ch.notes[1].hunkIds, []);
  assert.ok(json.findings.some((f) => f.code === 'stray-note' && f.message.includes('src/retry.js')));
});

test('walkthroughs without the new fields still load', () => {
  const { dir } = buildFixture();
  const r = verify({ cwd: dir, walkthrough: loadWalkthrough(wtPath(dir)) });
  for (const ch of r.chapters) {
    assert.deepEqual(ch.checks, []);
    assert.equal(ch.outsideTask, false);
    assert.deepEqual(ch.notes, []);
    assert.equal(ch.behaviour, null);
    assert.deepEqual(ch.dependents, []);
  }
  assert.ok(!r.findings.some((f) => f.code === 'stray-note'));
  assert.equal(r.background, null);
  assert.deepEqual(r.requested, []);
  assert.deepEqual(r.tryIt, []);
  assert.equal(r.diagram, null);
});

/** The fixture with its leftover script committed: the only change is that file, and everything else in the branch is unchanged. */
function oneFileChange() {
  const { dir, head } = buildFixture();
  execFileSync('git', ['add', 'scratch.js'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'Add the script'], { cwd: dir });
  const now = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const check = (wt) => verify({ cwd: dir, base: head, head: now, walkthrough: normalizeWalkthrough({ intent: 'x', ...wt, chapters: wt.chapters ?? [{ title: 'Script', why: 'y', hunks: ['scratch.js'] }] }) });
  return { check };
}

test('a behaviour change needs a before and an after', () => {
  const { check } = oneFileChange();
  const behaviour = (b) => check({ chapters: [{ title: 'Script', why: 'y', hunks: ['scratch.js'], behaviour: b }] }).chapters[0].behaviour;
  assert.deepEqual(behaviour({ before: 'Nothing.', after: 'It logs.', example: 'Prints 1.' }), { before: 'Nothing.', after: 'It logs.', example: 'Prints 1.' });
  assert.deepEqual(behaviour({ before: 'Nothing.', after: 'It logs.' }), { before: 'Nothing.', after: 'It logs.', example: null });
  assert.equal(behaviour({ after: 'It logs.' }), null);
  assert.equal(behaviour('nonsense'), null);
});

test('only files outside the diff that are in the branch count as relying on a change', () => {
  const { check } = oneFileChange();
  const dependents = [
    { path: 'src/sync.js', what: 'Uses it.' },
    { path: 'scratch.js', what: 'In the diff.' },
    { path: 'src/nowhere.js', what: 'Made up.' },
    { path: '../outside.js', what: 'Out of the repo.' },
    { path: '/etc/hosts', what: 'Absolute.' },
    { path: 'test/sync.test.js' },
    'nonsense',
  ];
  const r = check({ chapters: [{ title: 'Script', why: 'y', hunks: ['scratch.js'], dependents }] });
  assert.deepEqual(r.chapters[0].dependents, [{ path: 'src/sync.js', what: 'Uses it.' }]);
  const many = Array.from({ length: 8 }, () => ({ path: 'src/sync.js', what: 'Uses it.' }));
  assert.equal(check({ chapters: [{ title: 'Script', why: 'y', hunks: ['scratch.js'], dependents: many }] }).chapters[0].dependents.length, 5);
});

test('files in the working tree count when there is no head commit', () => {
  const { dir, head } = buildFixture();
  const r = verify({ cwd: dir, base: head, walkthrough: normalizeWalkthrough({ chapters: [{ title: 'Script', hunks: ['scratch.js'], dependents: [{ path: 'src/sync.js', what: 'Uses it.' }, { path: 'src', what: 'A folder.' }, { path: 'scratch.js', what: 'Untracked, but in the diff.' }] }] }) });
  assert.deepEqual(r.chapters[0].dependents.map((d) => d.path), ['src/sync.js']);
});

test('saying the change has what was asked needs a chapter that has it', () => {
  const { check } = oneFileChange();
  const requested = [
    { item: 'A script', status: 'done', chapters: ['Script'] },
    { item: 'Half a thing', status: 'partly', chapters: ['Script', 'Script'], note: 'No flags yet.' },
    { item: 'No proof', status: 'done', chapters: ['Not a chapter'] },
    { item: 'Also no proof', status: 'partly' },
    { item: 'Docs', status: 'missing', chapters: ['Script'], note: 'Looked in README.' },
    { item: 'A made-up status', status: 'finished', chapters: ['Script'] },
    'nonsense',
  ];
  assert.deepEqual(check({ requested }).requested, [
    { item: 'A script', status: 'done', chapters: [0], note: null },
    { item: 'Half a thing', status: 'partly', chapters: [0], note: 'No flags yet.' },
    { item: 'Docs', status: 'missing', chapters: [], note: 'Looked in README.' },
  ]);
});

test('background and how to try it pass through, without malformed steps', () => {
  const { check } = oneFileChange();
  const r = check({ background: 'Sync pushes one item at a time.', tryIt: [{ do: 'Run `npm test`', expect: 'It passes.' }, { do: 'Open it' }, { expect: 'No action.' }, 'nonsense'] });
  assert.equal(r.background, 'Sync pushes one item at a time.');
  assert.deepEqual(r.tryIt, [{ do: 'Run `npm test`', expect: 'It passes.' }, { do: 'Open it', expect: null }]);
  assert.equal(check({ background: '   ' }).background, null);
});

const DIAGRAM = {
  summary: 'A script that drives sync.',
  nodes: [
    { id: 'script', label: 'Debug script', kind: 'Tool', files: ['scratch.js'] },
    { id: 'sync', label: 'Sync', kind: 'Core', files: ['src/sync.js'], unchanged: true },
    { id: 'retry', label: 'Retry helper', files: ['src/retry.js'], unchanged: true },
  ],
  edges: [
    { from: 'script', to: 'sync', label: 'starts a sync' },
    { from: 'sync', to: 'retry' },
  ],
};

test('a diagram the diff backs up comes through whole', () => {
  const { check } = oneFileChange();
  const { diagram } = check({ diagram: DIAGRAM });
  assert.equal(diagram.summary, 'A script that drives sync.');
  assert.deepEqual(diagram.nodes.map((n) => [n.id, n.unchanged]), [['script', false], ['sync', true], ['retry', true]]);
  assert.deepEqual(diagram.edges[1], { from: 'sync', to: 'retry', label: null });
});

test('a box goes when its files contradict the diff, and so do its arrows', () => {
  const { check } = oneFileChange();
  const extra = (node) => check({ diagram: { ...DIAGRAM, nodes: [...DIAGRAM.nodes, node], edges: [...DIAGRAM.edges, { from: 'script', to: node.id }] } }).diagram;
  const ids = (d) => d.nodes.map((n) => n.id);
  for (const bad of [
    { id: 'x', label: 'Says changed, is not', files: ['src/sync.js'] },
    { id: 'x', label: 'Half changed', files: ['scratch.js', 'src/sync.js'] },
    { id: 'x', label: 'Says unchanged, is in the diff', files: ['scratch.js'], unchanged: true },
    { id: 'x', label: 'Not in the branch', files: ['src/nowhere.js'], unchanged: true },
    { id: 'x', label: 'No files', files: [] },
  ]) {
    const d = extra(bad);
    assert.deepEqual(ids(d), ['script', 'sync', 'retry'], bad.label);
    assert.ok(!d.edges.some((e) => e.to === 'x'), bad.label);
  }
});

test('too little left, or too much, means no diagram', () => {
  const { check } = oneFileChange();
  const [script, sync, retry] = DIAGRAM.nodes;
  assert.equal(check({ diagram: { ...DIAGRAM, nodes: [script, sync, { ...retry, files: ['src/nowhere.js'] }] } }).diagram, null, 'two boxes left');
  assert.equal(check({ diagram: { ...DIAGRAM, edges: [] } }).diagram, null, 'no arrows, and an unchanged box means nothing without one');
  assert.equal(check({ diagram: { ...DIAGRAM, edges: [{ from: 'script', to: 'nowhere' }, { from: 'sync', to: 'sync' }] } }).diagram, null, 'arrows that lead nowhere');
  assert.equal(check({ diagram: { nodes: [{ ...sync, id: 'a' }, { ...sync, id: 'b' }, { ...sync, id: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] } }).diagram, null, 'nothing in it changed');
  const crowd = Array.from({ length: 11 }, (_, i) => ({ ...sync, id: `n${i}` }));
  assert.equal(check({ diagram: { nodes: [script, ...crowd], edges: crowd.map((n) => ({ from: 'script', to: n.id })) } }).diagram, null, 'too many boxes to read');
  assert.equal(check({ diagram: 'nonsense' }).diagram, null);
});

test('normalizeWalkthrough accepts a parsed object and rejects bad input', () => {
  const wt = normalizeWalkthrough({ intent: 'x', chapters: [{ title: 'A', hunks: ['a.js'], checks: 'one check', notes: ['bad'] }] });
  assert.deepEqual(wt.chapters[0].checks, ['one check']);
  assert.deepEqual(wt.chapters[0].notes, {});
  assert.equal(wt.intent, 'x');
  assert.throws(() => normalizeWalkthrough({}), /chapters/);
});
