import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The real wtv engine on its own "sneaky agent" fixture repo.
import { buildFixture } from '../../tools/wtv/test/fixture.mjs';
import { normalizeWalkthrough, skeleton, verify } from '../../tools/wtv/src/verify.mjs';
import { attention, buildSteps, diffLines, estimateMinutes, rangeText } from '../src/main/steps.ts';
import { carryReviewed, isReviewed, orderSteps } from '../src/shared/order.ts';
import { sendBackPrompt } from '../src/main/actions.ts';

function fixture(edit?: (wt: { chapters: Record<string, unknown>[] }) => void) {
  const { dir } = buildFixture();
  const file = join(dir, '.review/walkthrough.json');
  const wt = JSON.parse(readFileSync(file, 'utf8'));
  edit?.(wt);
  const { byId: _b, ...r } = verify({ cwd: dir, walkthrough: normalizeWalkthrough(wt), base: undefined, head: undefined });
  return { dir, r: r as unknown as WtvResult };
}

test('every changed hunk lands in a step', () => {
  const { r } = fixture();
  const steps = buildSteps(r, 'agent');
  const covered = new Set(steps.flatMap((s) => s.hunkIds));
  for (const h of r.hunks) assert.ok(covered.has(h.id), `${h.path} is missing from the steps`);
});

test('chapters first, then one outside-the-task step per unexplained file, then skipped hunks', () => {
  const { r } = fixture();
  const steps = buildSteps(r, 'agent');
  assert.deepEqual(
    steps.map((s) => [s.source, s.title]),
    [
      ['chapter', 'Retry helper'],
      ['chapter', 'Use retry in sync'],
      ['chapter', 'Concurrency dependency'],
      ['unnarrated', 'Not in the walkthrough: scratch.js'],
      ['unnarrated', 'Not in the walkthrough: src/auth/token.js'],
      ['unnarrated', 'Not in the walkthrough: test/sync.test.js'],
      ['skipped', 'Formatting and generated files'],
    ]
  );
  assert.deepEqual(steps.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6]);
  for (const s of steps.filter((s) => s.source === 'unnarrated')) {
    assert.equal(s.outsideTask, true);
    assert.notEqual(s.risk, 'low', 'outside the task is at least "look closer"');
  }
  assert.equal(steps.find((s) => s.title.includes('token.js'))!.risk, 'high');
  assert.deepEqual(steps.at(-1)!.files, ['src/format.js']);
});

test('carries checks, outsideTask and notes from the walkthrough', () => {
  const { r } = fixture((wt) => {
    wt.chapters[0].checks = ['Is three attempts enough?'];
    wt.chapters[2].outsideTask = true;
    wt.chapters[1].risk = 'Retries could double-send';
  });
  const steps = buildSteps(r, 'agent');
  assert.deepEqual(steps[0].checks, ['Is three attempts enough?']);
  assert.deepEqual(steps[1].checks, ['Retries could double-send'], 'risk text becomes a check when there are none');
  assert.equal(steps[2].outsideTask, true);
  assert.equal(steps[2].risk, 'high', 'a dependency change stays high');
});

test('step keys are stable and unique', () => {
  const { r } = fixture((wt) => wt.chapters.push({ title: 'Retry helper', why: 'again', hunks: ['src/retry.js'] }));
  const steps = buildSteps(r, 'agent');
  const keys = steps.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys[0], 'ch:retry-helper');
  assert.equal(keys[3], 'ch:retry-helper-2');
  const again = buildSteps(fixture((wt) => wt.chapters.push({ title: 'Retry helper', why: 'again', hunks: ['src/retry.js'] })).r, 'agent');
  assert.deepEqual(again.map((s) => s.key), keys);
});

test('attention panel lists outside-task steps, risks, phantoms and findings', () => {
  const { r } = fixture();
  const steps = buildSteps(r, 'agent');
  const flags = attention(r, steps, 'agent');
  const titles = flags.map((f) => f.title);
  assert.equal(titles.filter((t) => t === 'Change outside your request').length, 3);
  assert.ok(titles.includes('Touches auth or security'));
  assert.ok(titles.includes('Dependency change'));
  assert.ok(flags.some((f) => f.title === 'Claim with no matching change' && f.detail.includes('src/sync/backoff.js') && f.stepKey === 'ch:retry-helper'));
  const auth = flags.find((f) => f.title === 'Touches auth or security')!;
  assert.equal(auth.severity, 'high');
  assert.match(auth.detail, /src\/auth\/token\.js in step 5/);
});

test('skeleton fallback: one step per file, no complaints about missing reasons', () => {
  const { dir } = buildFixture();
  const wt = normalizeWalkthrough(skeleton({ cwd: dir, base: undefined, head: undefined }));
  const { byId: _b, ...r } = verify({ cwd: dir, walkthrough: wt, base: undefined, head: undefined });
  const steps = buildSteps(r as unknown as WtvResult, 'skeleton');
  assert.ok(steps.filter((s) => s.source === 'skeleton').every((s) => s.files.length === 1 && s.why === '' && s.key.startsWith('file:')));
  assert.equal(steps.filter((s) => s.source === 'unnarrated').length, 0);
  const flags = attention(r as unknown as WtvResult, steps, 'skeleton');
  assert.ok(!flags.some((f) => f.title === 'Step without a reason' || f.title === 'No stated goal'));
});

test('review orders: story, riskiest first, by file', () => {
  const { r } = fixture();
  const steps = buildSteps(r, 'agent');
  assert.deepEqual(orderSteps(steps, 'story').map((s) => s.index), [0, 1, 2, 3, 4, 5, 6]);
  const risky = orderSteps(steps, 'risk');
  assert.equal(risky[0].risk, 'high');
  assert.equal(risky.at(-1)!.source, 'skipped');
  const byFile = orderSteps(steps, 'file').map((s) => s.files[0]);
  assert.deepEqual(byFile, [...byFile].sort());
});

test('a reviewed step needs review again when its hunks change', () => {
  const { r } = fixture();
  const [step] = buildSteps(r, 'agent');
  assert.ok(isReviewed(step, { [step.key]: [...step.hunkIds] }));
  assert.ok(!isReviewed(step, { [step.key]: [...step.hunkIds.slice(1), 'deadbeef00'] }));
  assert.ok(!isReviewed(step, {}));
});

test('diff rows add context around a zero-context hunk', () => {
  const oldText = 'a\nb\nc\nd\ne\nf\n';
  const newText = 'a\nb\nc\nX\ne\nf\n';
  const h = { id: 'x', path: 'f.txt', oldPath: 'f.txt', status: 'modified', synthetic: null, oldStart: 4, oldCount: 1, newStart: 4, newCount: 1, removed: ['d'], added: ['X'] } as unknown as WtvHunk;
  assert.deepEqual(diffLines(h, oldText, newText, 2), [
    { kind: 'ctx', oldN: 2, newN: 2, text: 'b' },
    { kind: 'ctx', oldN: 3, newN: 3, text: 'c' },
    { kind: 'del', oldN: 4, newN: null, text: 'd' },
    { kind: 'add', oldN: null, newN: 4, text: 'X' },
    { kind: 'ctx', oldN: 5, newN: 5, text: 'e' },
    { kind: 'ctx', oldN: 6, newN: 6, text: 'f' },
  ]);
  // Pure insertion after line 2: old count 0 means "after line oldStart".
  const ins = { ...h, oldStart: 2, oldCount: 0, newStart: 3, newCount: 1, removed: [], added: ['new'] } as unknown as WtvHunk;
  const rows = diffLines(ins, 'a\nb\nc\n', 'a\nb\nnew\nc\n', 1);
  assert.deepEqual(rows, [
    { kind: 'ctx', oldN: 2, newN: 2, text: 'b' },
    { kind: 'add', oldN: null, newN: 3, text: 'new' },
    { kind: 'ctx', oldN: 3, newN: 4, text: 'c' },
  ]);
  assert.equal(rangeText(h, 6), 'line 4');
  assert.equal(rangeText({ ...h, status: 'added', untracked: true } as unknown as WtvHunk, 12), 'new file · 12 lines · not committed');
});

test('estimates review time and builds the send-back message', () => {
  const { r } = fixture();
  const steps = buildSteps(r, 'agent');
  const minutes = estimateMinutes(steps, r.hunks);
  assert.ok(minutes >= 1);
  const withLockfile = [...r.hunks, { ...r.hunks[0], lockfile: true, added: Array(5000).fill('x'), removed: [] }];
  assert.equal(estimateMinutes(steps, withLockfile), minutes, 'lockfile lines are not reading time');
  const msg = sendBackPrompt(
    { steps },
    { comments: [{ id: '1', stepKey: steps[0].key, hunkId: null, line: null, body: 'Use the existing helper.', createdAt: '' }] },
    { note: 'Thanks', dropStepKeys: [steps[3].key] },
    'wtv verify'
  );
  assert.match(msg, /Step 1 "Retry helper" \(src\/retry\.js\): Use the existing helper\./);
  assert.match(msg, /Drop these steps[\s\S]*Step 4 "Not in the walkthrough: scratch\.js"/);
  assert.match(msg, /Note: Thanks/);
  assert.match(msg, /run `wtv verify` until it passes/);
});

test('a walkthrough that regroups the steps keeps what you reviewed in one step per file', () => {
  // One step per file: you reviewed a.ts (h1, h2) and half of what b.ts has.
  const reviewed = { 'file:a.ts': ['h1', 'h2'], 'file:b.ts-1': ['h3'] };
  const chapters = [
    { key: 'ch:0', hunkIds: ['h1', 'h3'] },
    { key: 'ch:1', hunkIds: ['h2'] },
    { key: 'ch:2', hunkIds: ['h2', 'h4'] },
  ];
  assert.deepEqual(carryReviewed(chapters, reviewed), {
    'ch:0': ['h1', 'h3'],
    'ch:1': ['h2'],
  });
});

test('a mark for a step that is gone stays while some of its hunks are in no reviewed step', () => {
  const next = carryReviewed([{ key: 'ch:0', hunkIds: ['h1'] }, { key: 'ch:1', hunkIds: ['h2', 'h9'] }], { 'file:a.ts': ['h1', 'h2'] });
  assert.deepEqual(next, { 'file:a.ts': ['h1', 'h2'], 'ch:0': ['h1'] });
  // Run again on its own output: nothing left to change.
  assert.equal(carryReviewed([{ key: 'ch:0', hunkIds: ['h1'] }, { key: 'ch:1', hunkIds: ['h2', 'h9'] }], next!), null);
});
