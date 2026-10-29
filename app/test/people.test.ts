import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hidesLocal, matchesPeople, peopleLine, peopleOptions } from '../src/shared/people.ts';
import type { InboxItem } from '../src/shared/types.ts';

type Item = Pick<InboxItem, 'pr' | 'openedBy' | 'openedByYou'>;
const pr = (over: Partial<NonNullable<InboxItem['pr']>> = {}): NonNullable<InboxItem['pr']> => ({ number: 1, isDraft: false, url: 'u', author: 'alice', assignees: [], requestedReviewers: [], reviews: [], ...over });
const local = (openedBy: string | null, openedByYou = false): Item => ({ pr: null, openedBy, openedByYou });

test('a PR card names who opened it, its reviewers and its assignees', () => {
  const w: Item = { openedBy: 'alice', openedByYou: false, pr: pr({ reviews: [{ login: 'bob', state: 'APPROVED' }], requestedReviewers: ['carol'], assignees: ['dave'] }) };
  assert.equal(peopleLine(w, null), 'Opened by alice · Review: bob ✓ approved, carol (requested) · Assigned: dave');
});

test('you read as "you", empty parts are left out, and review bots are skipped', () => {
  const w: Item = { openedBy: 'me', openedByYou: true, pr: pr({ author: 'me', reviews: [{ login: 'copilot-pull-request-reviewer', state: 'COMMENTED' }], assignees: ['me'] }) };
  assert.equal(peopleLine(w, 'me'), 'Opened by you · Assigned: you');
});

test('someone asked again after reviewing shows as requested, not twice', () => {
  const w: Item = { openedBy: 'alice', openedByYou: false, pr: pr({ reviews: [{ login: 'bob', state: 'CHANGES_REQUESTED' }], requestedReviewers: ['bob'] }) };
  assert.equal(peopleLine(w, null), 'Opened by alice · Review: bob (requested)');
});

test('a local branch card only says who opened it', () => {
  assert.equal(peopleLine(local('Elio Struyf', true), 'estruyf'), 'Opened by you');
  assert.equal(peopleLine(local('Sam'), null), 'Opened by Sam');
  assert.equal(peopleLine(local(null), null), '');
});

test('Assigned to and Review requested from only match PRs', () => {
  const mine: Item = { openedBy: 'alice', openedByYou: false, pr: pr({ assignees: ['me'], requestedReviewers: ['bob'] }) };
  assert.equal(matchesPeople(mine, 'assigned:me', 'me'), true);
  assert.equal(matchesPeople(mine, 'assigned:dave', 'me'), false);
  assert.equal(matchesPeople(mine, 'requested:bob', 'me'), true);
  assert.equal(matchesPeople(mine, 'requested:me', 'me'), false);
  assert.equal(matchesPeople(local('Elio', true), 'assigned:me', 'me'), false);
  assert.equal(matchesPeople(mine, 'assigned:me', null), false);
  assert.match(hidesLocal('assigned:me')!, /no assignees/);
  assert.equal(hidesLocal('opened:me'), null);
});

test('Opened by Me matches your PRs and your local branches; a name matches others', () => {
  const myPr: Item = { openedBy: 'me', openedByYou: true, pr: pr({ author: 'me' }) };
  assert.equal(matchesPeople(myPr, 'opened:me', 'me'), true);
  assert.equal(matchesPeople(local('Elio', true), 'opened:me', 'me'), true);
  assert.equal(matchesPeople(local('Sam'), 'opened:me', 'me'), false);
  assert.equal(matchesPeople(local('Sam'), 'opened:Sam', 'me'), true);
  assert.equal(matchesPeople(local('Sam'), 'anyone', null), true);
});

test('the options list everyone found on the items, without you', () => {
  const items: Item[] = [
    { openedBy: 'me', openedByYou: true, pr: pr({ assignees: ['me', 'dave'], requestedReviewers: ['acme/web', 'carol'] }) },
    { openedBy: 'alice', openedByYou: false, pr: pr({ assignees: ['dave'] }) },
    local('Elio Struyf', true),
    local('Sam'),
  ];
  assert.deepEqual(peopleOptions(items, 'me'), { assigned: ['dave'], requested: ['acme/web', 'carol'], opened: ['alice', 'Sam'] });
});
