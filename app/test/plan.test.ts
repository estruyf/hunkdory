import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisions, buildPlan, defaultDrops, openItems, planProgress, resumePoint, settleComment, skimGroups } from '../src/shared/plan.ts';
import { addToStepComment, removeFromStepComments } from '../src/shared/comments.ts';
import { prDescription } from '../src/main/actions.ts';
import type { AttentionFlag, ReviewState, Step } from '../src/shared/types.ts';

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

test('outside steps are only dropped when you decided to drop them', () => {
  const steps = [step(0, { outsideTask: true })];
  assert.deepEqual(defaultDrops(steps, undefined), []);
  assert.deepEqual(defaultDrops(steps, { outside: 'fine' }), []);
  assert.deepEqual(defaultDrops(steps, { outside: 'fix' }), ['k0']);
});

test('open items list undecided decisions, unreviewed steps and fixes you asked for', () => {
  const steps = [step(0, { risk: 'high' }), step(1, { outsideTask: true }), step(2)];
  const attention: AttentionFlag[] = [{ severity: 'high', title: 'Dependency change', detail: 'package.json in step 1.', stepKey: 'k0' }];
  const plan = buildPlan({ steps, attention, pr: null, prompt: 'Do it' }, { order: 'story' });
  const dep = plan.decisions.find((d) => d.kind === 'flag')!;
  const open = openItems(plan, { reviewed: { k0: ['h0'] }, settled: { [dep.id]: 'fix' } });
  assert.deepEqual(open.decisions.map((d) => d.id), ['outside']);
  assert.deepEqual(open.fixes.map((d) => d.id), [dep.id]);
  assert.deepEqual(open.careful.map((s) => s.key), ['k1']);
  assert.deepEqual(open.skim.map((s) => s.key), ['k2']);
  // Dropping outside steps is your call, not a fix to warn about.
  assert.deepEqual(openItems(plan, { reviewed: {}, settled: { outside: 'fix' } }).fixes, []);
});

test('changing a "needs a fix" back to fine takes its line out of the step comment', () => {
  const r = { comments: [] as ReviewState['comments'] };
  const { body } = settleComment({ kind: 'flag', title: 'Dependency change', detail: 'package.json in step 1.' }, 'k0')!;
  addToStepComment(r, 'k0', 'Pin the version.');
  addToStepComment(r, 'k0', body);
  addToStepComment(r, 'k0', body);
  assert.equal(r.comments[0].body, `Pin the version.\n${body}`);
  removeFromStepComments(r, body);
  assert.equal(r.comments[0].body, 'Pin the version.');
  // A comment that only held the line goes away.
  addToStepComment(r, 'k1', body);
  removeFromStepComments(r, body);
  assert.deepEqual(r.comments.map((c) => c.stepKey), ['k0']);
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
    { severity: 'high', title: 'Error swallowed', detail: 'a.ts in step 3.', stepKey: 'k2' },
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

test('medium flags on a step are notes on that step, not decisions', () => {
  const steps = [step(0, { risk: 'medium' }), step(1)];
  const attention: AttentionFlag[] = [
    { severity: 'medium', title: 'Error swallowed', detail: 'a.ts in step 1.', stepKey: 'k0' },
    { severity: 'medium', title: 'No tests changed', detail: 'Code changed but no test files changed.', stepKey: null },
  ];
  const plan = buildPlan({ steps, attention, pr: null, prompt: 'Do it' }, { order: 'story' });
  assert.deepEqual(plan.decisions.map((d) => d.title), ['No tests changed']);
  assert.deepEqual(plan.notes.map((d) => d.title), ['Error swallowed']);
});
