import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisions, buildPlan, defaultDrops, planProgress, resumePoint, skimGroups } from '../src/shared/plan.ts';
import { prDescription } from '../src/main/actions.ts';
import type { AttentionFlag, Step } from '../src/shared/types.ts';

const step = (i: number, over: Partial<Step> = {}): Step => ({
  key: `k${i}`, index: i, title: `Step ${i}`, why: '', checks: [], risk: 'low', outsideTask: false, source: 'chapter',
  hunkIds: [`h${i}`], files: [`src/area${i % 2}/file${i}.ts`], added: 1, removed: 0, ...over,
});

test('outside-the-task steps become one decision, however many there are', () => {
  const steps = [step(0), step(1, { outsideTask: true }), step(2, { outsideTask: true })];
  const flags: AttentionFlag[] = [
    { severity: 'medium', title: 'Change outside your request', detail: 'Step 2 changes a.', stepKey: 'k1' },
    { severity: 'medium', title: 'Change outside your request', detail: 'Step 3 changes b.', stepKey: 'k2' },
  ];
  const d = buildDecisions(steps, flags, [], true);
  assert.equal(d.length, 1);
  assert.equal(d[0].id, 'outside');
  assert.deepEqual(d[0].stepKeys, ['k1', 'k2']);
});

test('flags of one kind group together, high severity and failing CI first', () => {
  const steps = [step(0), step(1)];
  const flags: AttentionFlag[] = [
    { severity: 'medium', title: 'New dependency', detail: 'package.json', stepKey: 'k0' },
    { severity: 'high', title: 'Auth code changed', detail: 'a.ts', stepKey: 'k0' },
    { severity: 'high', title: 'Auth code changed', detail: 'b.ts', stepKey: 'k1' },
  ];
  const d = buildDecisions(steps, flags, [{ name: 'build', state: 'fail', url: null }], true);
  assert.deepEqual(d.map((x) => x.kind), ['ci', 'flag', 'flag']);
  assert.equal(d[1].title, 'Auth code changed (2 places)');
  assert.deepEqual(d[1].stepKeys, ['k0', 'k1']);
});

test('risky and outside steps come first in the walkthrough, then the skim', () => {
  const steps = [step(0), step(1, { risk: 'high' }), step(2), step(3, { outsideTask: true }), step(4, { source: 'skipped', risk: 'medium' })];
  const plan = buildPlan({ steps, attention: [], pr: null, prompt: 'x' }, { order: 'story' });
  assert.deepEqual(plan.careful.map((s) => s.key), ['k1', 'k3']);
  assert.deepEqual(plan.sequence.slice(0, 2).map((s) => s.key), ['k1', 'k3']);
  assert.equal(plan.sequence.length, 5);
  const p = planProgress(plan, { reviewed: { k1: ['h1'] }, settled: {} });
  assert.equal(p.carefulDone, 1);
});

test('skim groups stay at six at most', () => {
  const steps = Array.from({ length: 10 }, (_, i) => step(i, { files: [`a/b${i}/f.ts`] }));
  const groups = skimGroups(steps);
  assert.equal(groups.length, 6);
  assert.equal(groups.at(-1)!.name, 'Other');
  assert.equal(groups.reduce((n, g) => n + g.steps.length, 0), 10);
});

test('keeping outside steps means none get dropped', () => {
  const steps = [step(0, { outsideTask: true })];
  assert.deepEqual(defaultDrops(steps, undefined), ['k0']);
  assert.deepEqual(defaultDrops(steps, { outside: 'fine' }), []);
});

test('the PR description has the goal and your comments', () => {
  const body = prDescription({ steps: [step(0)], intent: 'Add CSV export', prompt: null }, { comments: [{ id: 'c', stepKey: 'k0', hunkId: 'h0', line: 3, path: 'a.ts', body: 'Rename this', createdAt: '' }] }, '');
  assert.match(body, /^Add CSV export/);
  assert.match(body, /Step 1: Step 0\*\* \(`a.ts:3`\): Rename this/);
});

test('continuing a review starts at the first open decision, then the first unreviewed step', () => {
  const steps = [step(0, { risk: 'high' }), step(1, { risk: 'high' }), step(2)];
  const attention: AttentionFlag[] = [
    { severity: 'high', title: 'Dependency change', detail: 'package.json in step 2.', stepKey: 'k1' },
    { severity: 'medium', title: 'Error swallowed', detail: 'a.ts in step 3.', stepKey: 'k2' },
  ];
  const plan = buildPlan({ steps, attention, pr: null, prompt: 'Do it' }, { order: 'story' });
  const [dep, swallowed] = plan.decisions;
  // Step 1 is reviewed and the first decision was put off: back to that decision, not on to step 2.
  const r1 = resumePoint(plan, { reviewed: { k0: ['h0'] }, settled: { [swallowed.id]: 'fine' } });
  assert.deepEqual(r1 && { d: r1.decision?.id, s: r1.stepKey }, { d: dep.id, s: 'k1' });
  // Every decision made: the first step not reviewed yet, even if a later one is.
  const r2 = resumePoint(plan, { reviewed: { k0: ['h0'], k2: ['h2'] }, settled: { [dep.id]: 'fine', [swallowed.id]: 'fix' } });
  assert.deepEqual(r2 && { d: r2.decision, s: r2.stepKey }, { d: null, s: 'k1' });
  assert.equal(resumePoint(plan, { reviewed: { k0: ['h0'], k1: ['h1'], k2: ['h2'] }, settled: { [dep.id]: 'fine', [swallowed.id]: 'fine' } }), null);
});
