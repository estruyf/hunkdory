import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubLink } from '../src/shared/decisions.ts';

const PR = 'https://github.com/acme/app/pull/7';
const REVIEW = `${PR}#pullrequestreview-123`;

test('a review posted on GitHub links to the review', () => {
  assert.equal(githubLink({ github: { event: 'COMMENT', url: REVIEW, prUrl: PR } }), REVIEW);
});

test('a merge that posted no review falls back to the pull request', () => {
  assert.equal(githubLink({ github: { event: 'COMMENT', url: null, prUrl: PR } }), PR);
});

test('older records without the PR URL, and local decisions, have no link', () => {
  assert.equal(githubLink({ github: { event: 'COMMENT', url: null } }), null);
  assert.equal(githubLink({}), null);
  assert.equal(githubLink(null), null);
});
