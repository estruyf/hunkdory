import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route } from '../src/renderer/App.tsx';
import { activate, activeRoute, closeTab, INBOX, move, navigate, reopenTab, restoreTabs, savedTabs, startTabs, stepTab, tabAt, withoutProjectsGone } from '../src/renderer/state/tabs.ts';

const plan = (branch: string, projectId = 'p'): Route => ({ name: 'plan', projectId, branch });
const review = (branch: string, stepKey: string): Route => ({ name: 'review', projectId: 'p', branch, stepKey });
const done = (branch: string): Route => ({ name: 'done', projectId: 'p', branch, result: { ok: true, message: 'x' } as never });
const home = startTabs({ name: 'home' });
const ids = (s: typeof home) => s.tabs.map((t) => t.id);

test('opening a branch gives it a tab next to the inbox', () => {
  const s = navigate(navigate(home, plan('a')), plan('b'));
  assert.deepEqual(ids(s), [INBOX, 'p::a', 'p::b']);
  assert.equal(s.active, 'p::b');
});

test('the same branch name in two projects gets two tabs', () => {
  assert.deepEqual(ids(navigate(navigate(home, plan('a', 'p')), plan('a', 'q'))), [INBOX, 'p::a', 'q::a']);
});

test('going to the inbox and back to a branch finds it where you left it', () => {
  const inReview = navigate(navigate(home, plan('a')), review('a', 'step-3'));
  const away = navigate(inReview, { name: 'home' });
  assert.equal(activeRoute(away)?.name, 'home');
  // The inbox's tab didn't grow: you went back to it.
  assert.equal(away.tabs[0]!.stack.length, 1);
  assert.deepEqual(activeRoute(navigate(away, plan('a'))), review('a', 'step-3'));
});

test('steps of a review stay in their tab, with their own history', () => {
  const a = navigate(navigate(home, plan('a')), review('a', 's1'));
  const both = navigate(navigate(a, plan('b')), review('b', 'x'));
  const backInA = activate(both, 'p::a');
  assert.deepEqual(activeRoute(move(backInA, -1)), plan('a'));
  assert.deepEqual(activeRoute(activate(move(backInA, -1), 'p::b')), review('b', 'x'));
});

test('a branch asked for with its data or a place goes there in its open tab', () => {
  const s = navigate(navigate(navigate(home, plan('a')), { name: 'home' }), review('a', 's9'));
  assert.equal(s.active, 'p::a');
  assert.deepEqual(activeRoute(s), review('a', 's9'));
});

test('back from a first screen is the inbox, and forward returns', () => {
  const s = navigate(home, plan('a'));
  const back = move(s, -1);
  assert.equal(back.active, INBOX);
  assert.equal(move(back, 1).active, 'p::a');
  assert.equal(move(move(back, 1), 1).active, 'p::a');
  assert.equal(move(home, -1), home);
});

test('forward forgets a tab you closed', () => {
  const back = move(navigate(home, plan('a')), -1);
  assert.equal(move(closeTab(back, 'p::a'), 1).active, INBOX);
});

test('a finished review backs out to the inbox, and its tab goes when you leave', () => {
  const s = navigate(navigate(navigate(home, plan('a')), review('a', 's1')), done('a'));
  assert.equal(s.tabs[1]!.stack.length, 1);
  const back = move(s, -1);
  assert.equal(back.active, INBOX);
  assert.deepEqual(ids(back), [INBOX]);
  assert.deepEqual(ids(navigate(s, plan('b'))), [INBOX, 'p::b']);
  assert.deepEqual(ids(activate(navigate(navigate(s, { name: 'home' }), plan('a')), INBOX)), [INBOX, 'p::a']);
});

test('a tab in the background moves on without taking over the screen', () => {
  const s = navigate(navigate(home, { name: 'finish', projectId: 'p', branch: 'a' }), plan('b'));
  const merged = navigate(s, done('a'), 'p::a');
  assert.equal(merged.active, 'p::b');
  assert.equal(merged.tabs[1]!.stack[0]!.name, 'done');
  // Nor can it send you elsewhere, or come back after you closed it.
  assert.equal(navigate(s, { name: 'home' }, 'p::a'), s);
  const closed = closeTab(s, 'p::a');
  assert.equal(navigate(closed, done('a'), 'p::a'), closed);
});

test('picking a branch leaves the inbox tab on the inbox', () => {
  const picking = navigate(home, { name: 'pick' });
  assert.equal(activeRoute(picking)?.name, 'pick');
  const s = navigate(picking, plan('a'));
  assert.equal(activeRoute(activate(s, INBOX))?.name, 'home');
  // ⌘N from a review goes to the list in the inbox's tab, and ⌘⇧H finds the inbox again.
  const fromReview = navigate(navigate(navigate(home, plan('a')), { name: 'pick' }), plan('a'));
  assert.equal(fromReview.active, 'p::a');
  assert.equal(activeRoute(navigate(navigate(navigate(home, plan('a')), { name: 'pick' }), { name: 'home' }))?.name, 'home');
});

test('closing a tab hands over to its right, then its left, and the inbox stays', () => {
  const s = navigate(navigate(navigate(home, plan('a')), plan('b')), plan('c'));
  assert.equal(closeTab(activate(s, 'p::b'), 'p::b').active, 'p::c');
  assert.equal(closeTab(s, 'p::c').active, 'p::b');
  assert.equal(closeTab(s, 'p::a').active, 'p::c');
  assert.equal(closeTab(s, INBOX), s);
  assert.equal(closeTab(closeTab(navigate(home, plan('a')), 'p::a'), 'p::a').active, INBOX);
});

test('stepping wraps around and ⌘9 is the last tab', () => {
  const s = navigate(navigate(home, plan('a')), plan('b'));
  assert.equal(stepTab(s, 1), INBOX);
  assert.equal(stepTab(s, -1), 'p::a');
  assert.equal(tabAt(s, 1), INBOX);
  assert.equal(tabAt(s, 2), 'p::a');
  assert.equal(tabAt(s, 9), 'p::b');
  assert.equal(tabAt(s, 5), null);
});

test('removing a project closes its tabs, and nothing changes otherwise', () => {
  const s = navigate(navigate(home, plan('a', 'p')), plan('b', 'q'));
  assert.equal(withoutProjectsGone(s, new Set(['p', 'q'])), s);
  const gone = withoutProjectsGone(s, new Set(['p']));
  assert.deepEqual(ids(gone), [INBOX, 'p::a']);
  assert.equal(gone.active, 'p::a');
});

test('tabs come back between runs, at their place and without the data', () => {
  const data = { data: {}, state: {} } as never;
  const s = navigate(navigate(navigate(home, plan('a')), { name: 'review', projectId: 'p', branch: 'a', stepKey: 's2', preloaded: data, reload: 5 }), { name: 'finish', projectId: 'p', branch: 'b' });
  const saved = JSON.parse(JSON.stringify(savedTabs(s)));
  assert.deepEqual(saved.tabs, [{ name: 'review', projectId: 'p', branch: 'a', stepKey: 's2' }, plan('b')]);
  const back = restoreTabs(saved, new Set(['p']));
  assert.deepEqual(ids(back), [INBOX, 'p::a', 'p::b']);
  assert.equal(back.active, 'p::b');
  assert.equal(activeRoute(back)?.name, 'plan');
});

test('a finished tab is not saved, and the active one falls back to the inbox', () => {
  const saved = savedTabs(navigate(navigate(home, plan('a')), done('a')));
  assert.deepEqual(saved.tabs, []);
  assert.equal(restoreTabs(saved, new Set(['p'])).active, INBOX);
});

test('what was saved is not trusted', () => {
  for (const junk of [null, 'x', 3, {}, { tabs: 'x' }, { tabs: [null, 1, { name: 'done', projectId: 'p', branch: 'a' }, { name: 'plan', projectId: 'p' }] }]) {
    assert.deepEqual(restoreTabs(junk, new Set(['p'])), home);
  }
  const elsewhere = restoreTabs({ tabs: [plan('a', 'gone'), plan('b')], active: 'gone::a' }, new Set(['p']));
  assert.deepEqual(ids(elsewhere), [INBOX, 'p::b']);
  assert.equal(elsewhere.active, INBOX);
});

test('reopening brings back the tab closed last, where it stood and at your place, read again', () => {
  const data = { data: {}, state: {} } as never;
  const open = navigate(navigate(navigate(home, plan('a')), { name: 'review', projectId: 'p', branch: 'a', stepKey: 's2', preloaded: data }), plan('b'));
  const s = reopenTab(closeTab(open, 'p::a'));
  assert.deepEqual(ids(s), [INBOX, 'p::a', 'p::b']);
  assert.equal(s.active, 'p::a');
  assert.deepEqual(JSON.parse(JSON.stringify(activeRoute(s))), review('a', 's2'));
  // Its history went with it: back is the inbox, as for any first screen.
  assert.equal(move(s, -1).active, INBOX);
});

test('reopening goes back through what you closed, and then does nothing', () => {
  const open = navigate(navigate(home, plan('a')), plan('b'));
  const none = closeTab(closeTab(open, 'p::b'), 'p::a');
  assert.deepEqual(ids(none), [INBOX]);
  const first = reopenTab(none);
  assert.equal(first.active, 'p::a');
  const second = reopenTab(first);
  assert.equal(second.active, 'p::b');
  assert.deepEqual(ids(second), [INBOX, 'p::a', 'p::b']);
  assert.equal(reopenTab(second), second);
  assert.equal(reopenTab(home), home);
});

test('a tab you opened again since is skipped, and closing it again counts once', () => {
  const closed = closeTab(closeTab(navigate(navigate(home, plan('a')), plan('b')), 'p::a'), 'p::b');
  const again = navigate(closed, plan('b'));
  assert.equal(reopenTab(again).active, 'p::a');
  assert.deepEqual(closeTab(again, 'p::b').closed?.map((c) => c.route), [plan('a'), plan('b')]);
});

test('a finished review does not come back, nor a project you removed', () => {
  const finished = navigate(navigate(home, plan('a')), done('a'));
  assert.equal(reopenTab(closeTab(finished, 'p::a')).active, INBOX);
  assert.equal(reopenTab(activate(finished, INBOX)).active, INBOX);
  const removed = withoutProjectsGone(closeTab(navigate(home, plan('a', 'q')), 'q::a'), new Set(['p']));
  assert.equal(reopenTab(removed).active, INBOX);
});

test('other tabs moving around does not lose what you closed, and it only goes back so far', () => {
  const closed = closeTab(navigate(navigate(home, plan('a')), plan('b')), 'p::a');
  assert.equal(reopenTab(activate(move(closed, -1), 'p::b')).active, 'p::a');
  let many = home;
  for (let i = 0; i < 25; i++) many = closeTab(navigate(many, plan(`b${i}`)), `p::b${i}`);
  assert.equal(many.closed?.length, 20);
  assert.equal(many.closed?.[0]?.route && 'branch' in many.closed[0].route && many.closed[0].route.branch, 'b5');
});
