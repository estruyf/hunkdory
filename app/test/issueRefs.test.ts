import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRefs, issueLinks } from '../src/shared/issueRefs.ts';
import { toIssueRefs } from '../src/main/github.ts';
import type { IssueRefs } from '../src/shared/types.ts';

const REPO = 'https://github.com/acme/app';
const numbers = (...texts: string[]) => findRefs(texts, REPO).map((r) => r.number);

test('finds references in order, once each, across texts', () => {
  assert.deepEqual(numbers('Part of #2411. Stack: #2434 → #2435 → this PR', 'Again #2411 and (#2424)'), [2411, 2434, 2435, 2424]);
});

test('a number that is part of something else is not a reference', () => {
  assert.deepEqual(numbers('See page.html#12, a/b#13, /path/#14, &#15; and ##16, #0 and #1234567890'), []);
});

test('what is in code is not a reference', () => {
  assert.deepEqual(numbers('`color: #123`\n```\n#124\n```\n<!-- #125 --> #126'), [126]);
  assert.deepEqual(numbers('```\n#124 in a block never closed'), []);
});

test('a link to an issue or PR in this repo counts, in another repo it does not', () => {
  assert.deepEqual(numbers(`${REPO}/issues/7 ${REPO}/pull/8 https://github.com/other/app/issues/9 ${REPO}.evil/issues/10`), [7, 8]);
});

test('only the reference right after a closing word closes', () => {
  assert.deepEqual(findRefs(['Fixes #1, #2. closes: #3. Resolved #4. fix(common): done (#5). Part of #6', `Fixes ${REPO}/issues/7`], REPO), [
    { number: 1, closes: true },
    { number: 2, closes: false },
    { number: 3, closes: true },
    { number: 4, closes: true },
    { number: 5, closes: false },
    { number: 6, closes: false },
    { number: 7, closes: true },
  ]);
});

test('a later "Fixes" counts for a number mentioned before it', () => {
  assert.deepEqual(findRefs(['About #1.', 'Fixes #1'], REPO), [{ number: 1, closes: true }]);
});

const refs: IssueRefs = {
  repoUrl: REPO,
  refs: [{ number: 2424, kind: 'issue', title: 'Sending fails', state: 'open', url: `${REPO}/issues/2424`, body: '', closes: true }, { number: 2434, kind: 'pr', title: 'Sort first', state: 'merged', url: `${REPO}/pull/2434`, body: '', closes: false }],
  missing: [4809],
};
const paragraph = (...children: object[]) => ({ type: 'root', children: [{ type: 'paragraph', children }] });
const linked = (tree: { children: { children: object[] }[] }) => {
  issueLinks(refs)()(tree as never);
  return tree.children[0].children;
};

test('a known number links to where it really is, with its title and state', () => {
  assert.deepEqual(linked(paragraph({ type: 'text', value: 'Fixes #2424 → #2434.' })), [
    { type: 'text', value: 'Fixes ' },
    { type: 'link', url: `${REPO}/issues/2424`, title: 'Sending fails · Open', children: [{ type: 'text', value: '#2424' }] },
    { type: 'text', value: ' → ' },
    { type: 'link', url: `${REPO}/pull/2434`, title: 'Sort first · Merged', children: [{ type: 'text', value: '#2434' }] },
    { type: 'text', value: '.' },
  ]);
});

test('a number nobody looked up still links, and one GitHub does not know stays text', () => {
  assert.deepEqual(linked(paragraph({ type: 'text', value: '#9 and #4809' })), [
    { type: 'link', url: `${REPO}/issues/9`, title: null, children: [{ type: 'text', value: '#9' }] },
    { type: 'text', value: ' and #4809' },
  ]);
  const text = { type: 'text', value: 'Only #4809' };
  assert.deepEqual(linked(paragraph(text)), [text]);
});

test('references inside other formatting link, inside a link or code they stay as they are', () => {
  const inLink = { type: 'link', url: 'https://example.test', children: [{ type: 'text', value: '#2424' }] };
  const inCode = { type: 'inlineCode', value: '#2424' };
  assert.deepEqual(linked(paragraph(inLink, inCode)), [inLink, inCode]);
  const [bold] = linked(paragraph({ type: 'strong', children: [{ type: 'text', value: '#2424' }] })) as { children: { type: string }[] }[];
  assert.equal(bold.children[0].type, 'link');
});

test("GitHub's answer: closing issues first, unknown numbers set apart, a PR without a body of its own", () => {
  const wanted = [{ number: 1, closes: false }, { number: 2, closes: true }, { number: 3, closes: false }, { number: 4, closes: false }];
  const out = toIssueRefs(REPO, wanted, {
    n1: { __typename: 'PullRequest', number: 1, title: 'A PR', state: 'MERGED', url: `${REPO}/pull/1` },
    n2: { __typename: 'Issue', number: 2, title: 'An issue', state: 'CLOSED', url: `${REPO}/issues/2`, body: 'It broke.' },
    n3: null,
  });
  assert.deepEqual(out.missing, [3, 4]);
  assert.deepEqual(out.refs.map((r) => [r.number, r.kind, r.state, r.closes, r.body]), [[2, 'issue', 'closed', true, 'It broke.'], [1, 'pr', 'merged', false, '']]);
});
