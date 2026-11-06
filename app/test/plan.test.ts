import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisions, buildPlan, decisionsForComment, defaultDrops, defaultReviewEvent, fileNames, openItems, planProgress, resumePoint, settleComment, skimGroups, stepsLabel, unpushedWork, vouchesForCode } from '../src/shared/plan.ts';
import { addToStepComment, removeFromStepComments } from '../src/shared/comments.ts';
import { prDescription } from '../src/main/actions.ts';
import type { AttentionFlag, CheckItem, ReviewState, Step } from '../src/shared/types.ts';

const step = (i: number, over: Partial<Step> = {}): Step => ({
  key: `k${i}`, index: i, title: `Step ${i}`, why: '', checks: [], risk: 'low', riskNote: null, outsideTask: false, noTestChange: false, choices: [], behaviour: null, dependents: [], source: 'chapter',
  hunkIds: [`h${i}`], files: [`src/area${i % 2}/file${i}.ts`], added: 1, removed: 0, ...over,
});

test('a serious AI finding you haven’t dismissed takes a step out of the skim', () => {
  const steps = [step(0), step(1), step(2)];
  const finding = (hunkId: string, severity: 'high' | 'medium' | 'low', dismissed = false) => ({ id: hunkId, severity, area: 'bugs' as const, title: 't', fails: 'f', hunkId, path: 'a', line: 1, side: 'RIGHT' as const, dismissed, commentId: null });
  const plan = (findings: ReturnType<typeof finding>[]) =>
    buildPlan({ steps, attention: [], pr: null, prompt: 'x' }, { order: 'story', aiReview: { status: 'done', activity: null, error: null, startedAt: 'now', result: { finishedAt: 'now', assistant: 'A', areas: ['bugs'], depth: 'quick', hunkIds: [], findings, dropped: 0, cut: 0, costUsd: null } } });
  assert.deepEqual(plan([]).careful, []);
  assert.deepEqual(plan([finding('h1', 'high'), finding('h2', 'medium')]).careful.map((s) => s.key), ['k1', 'k2']);
  assert.deepEqual(plan([finding('h1', 'low')]).careful, [], 'a low one only gets a label');
  assert.deepEqual(plan([finding('h1', 'high', true)]).careful, [], 'dismissed');
  assert.deepEqual(plan([finding('h1', 'high')]).skim.map((s) => s.key), ['k0', 'k2']);
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

test('a flag about places in the diff gives its files, steps and reason apart, and every step it names', () => {
  const where = { files: ['a/b/one.test.ts', 'c/two.test.ts'], steps: [62, 65], reason: 'Matched “assert” on line 3 of one.test.ts, first of them.' };
  const [d] = buildDecisions([step(62), step(65)], [{ severity: 'medium', title: 'Lost 1 assertion', detail: 'a/b/one.test.ts, c/two.test.ts in steps 63, 66.', stepKey: 'k62', where }], [], true);
  assert.deepEqual(d.files, where.files);
  assert.deepEqual(d.stepIndexes, [62, 65]);
  assert.equal(d.note, where.reason);
  assert.deepEqual(d.stepKeys, ['k62'], 'where you start stays the same');
  assert.match(d.detail, /a\/b\/one\.test\.ts/, 'comments still name the paths');
});

test('a flag without places keeps its detail as the note', () => {
  const [d] = buildDecisions([], [{ severity: 'medium', title: 'Asked for, but not found', detail: 'Dark mode', stepKey: null }], [], true);
  assert.equal(d.note, 'Dark mode');
  assert.deepEqual(d.files, []);
  assert.deepEqual(d.stepIndexes, []);
});

test('file names and steps read as a short line', () => {
  assert.equal(fileNames(['a/b/one.ts']), 'one.ts');
  assert.equal(fileNames(['a/one.ts', 'b/two.ts']), 'one.ts and two.ts');
  assert.equal(fileNames(['a/one.ts', 'b/two.ts', 'c/three.ts', 'd/four.ts']), 'one.ts, two.ts and 2 more');
  assert.equal(stepsLabel([2]), 'Step 3');
  assert.equal(stepsLabel([62, 65]), 'Steps 63 and 66');
  assert.equal(stepsLabel([0, 1, 2]), 'Steps 1, 2 and 3');
  assert.equal(stepsLabel([0, 1, 2, 3, 4, 5]), 'Steps 1, 2, 3, 4 and 2 more');
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

test('decisions read as lines for a PR comment, without the app\'s words or failing CI', () => {
  const steps = [step(0, { outsideTask: true, title: 'Bump lint' }), step(1)];
  const flags: AttentionFlag[] = [{ severity: 'high', title: 'Touches auth', detail: 'token.js in step 2.', stepKey: 'k1' }];
  const checks: CheckItem[] = [{ name: 'ci', state: 'fail', url: null } as CheckItem];
  const lines = decisionsForComment(buildDecisions(steps, flags, checks, true));
  assert.deepEqual(lines, ['**Touches auth.** token.js in step 2.', '**Outside the request.** Step 1: Bump lint.']);
});

test('a review on GitHub only starts as an approval once nothing is left open', () => {
  const none = { decisions: [], careful: [], skim: [], fixes: [] };
  const opts = { comments: 0, prByYou: false };
  assert.equal(defaultReviewEvent(none, opts), 'APPROVE');
  assert.equal(defaultReviewEvent({ ...none, skim: [step(0)] }, opts), 'COMMENT', 'nothing reviewed yet');
  assert.equal(defaultReviewEvent({ ...none, careful: [step(0)] }, opts), 'COMMENT');
  assert.equal(defaultReviewEvent({ ...none, decisions: [{ id: 'd' } as never] }, opts), 'COMMENT');
  assert.equal(defaultReviewEvent(none, { comments: 1, prByYou: false }), 'COMMENT');
  assert.equal(defaultReviewEvent(none, { comments: 0, prByYou: true }), 'COMMENT', "GitHub won't take your approval of your own");
  assert.equal(defaultReviewEvent({ ...none, skim: [step(0)], fixes: [{ id: 'd' } as never] }, opts), 'REQUEST_CHANGES');
});

test('merging and approving vouch for the code; other reviews and finishes do not', () => {
  assert.equal(vouchesForCode('merge', 'COMMENT'), true);
  assert.equal(vouchesForCode('github', 'APPROVE'), true);
  assert.equal(vouchesForCode('github', 'COMMENT'), false);
  assert.equal(vouchesForCode('github', 'REQUEST_CHANGES'), false);
  assert.equal(vouchesForCode('send-back', 'APPROVE'), false);
  assert.equal(vouchesForCode('discard', 'APPROVE'), false);
});

test('work that is only on this Mac holds a PR back, and says what it is', () => {
  const pr = { number: 3 } as never;
  assert.equal(unpushedWork({ pr: null, dirtyFiles: 2, ahead: 1 }), null, 'a local branch merges what it has');
  assert.equal(unpushedWork({ pr, dirtyFiles: 0, ahead: 0 }), null);
  assert.equal(unpushedWork({ pr, dirtyFiles: 1, ahead: 0 }), "1 uncommitted file on this Mac isn't on PR #3, so GitHub wouldn't merge it. Push it from the plan, or undo it, first.");
  assert.equal(unpushedWork({ pr, dirtyFiles: 2, ahead: 1 }), "2 uncommitted files and 1 unpushed commit on this Mac aren't on PR #3, so GitHub wouldn't merge them. Push them from the plan, or undo them, first.");
});
