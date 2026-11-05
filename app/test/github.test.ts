import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorText, baseRef, fetchError, fetchRefspecs, signInFailed, foldComments, isCopilot, isOwnPrError, parseChecks, prRef, readWalkthroughComment, stackOf, toPullRequest, walkthroughComment, type RawPullRequest } from '../src/main/github.ts';
import type { PullRequest } from '../src/shared/types.ts';

const pr = (number: number, headRefOid: string, baseRefName = 'develop/5.5'): PullRequest => ({
  number,
  title: `PR ${number}`,
  headRefName: `feat/${number}`,
  headRefOid,
  baseRefName,
  author: 'someone',
  isBot: false,
  isDraft: false,
  url: `https://github.com/acme/app/pull/${number}`,
  body: '',
  updatedAt: '2026-10-28T10:00:00Z',
  copilot: false,
  fork: false,
  checks: [],
  assignees: [],
  requestedReviewers: [],
  reviews: [],
});

test('fetches only pull requests whose head moved, into a private namespace', () => {
  const have = new Map([[prRef(1), 'aaa']]);
  const specs = fetchRefspecs([pr(1, 'aaa'), pr(2, 'bbb'), pr(3, 'ccc', 'main')], have);
  assert.deepEqual(specs, [
    '+refs/pull/2/head:refs/reviewer/pr/2',
    '+refs/pull/3/head:refs/reviewer/pr/3',
    '+refs/heads/develop/5.5:refs/reviewer/base/develop/5.5',
    '+refs/heads/main:refs/reviewer/base/main',
  ]);
  assert.ok(specs.every((s) => s.split(':')[1].startsWith('refs/reviewer/')), 'never writes to your branches');
});

test('nothing to fetch when every head is current', () => {
  assert.deepEqual(fetchRefspecs([pr(1, 'aaa')], new Map([[prRef(1), 'aaa']])), []);
  assert.equal(baseRef('develop/5.5'), 'refs/reviewer/base/develop/5.5');
});

test('checks: runs and statuses become pass, fail, pending or skipped', () => {
  const checks = parseChecks([
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/1' },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING', targetUrl: 'https://ci/2' },
    { __typename: 'StatusContext', context: 'ci/old', state: 'ERROR' },
  ]);
  assert.deepEqual(
    checks.map((c) => [c.name, c.state]),
    [['build', 'pass'], ['test', 'fail'], ['lint', 'pending'], ['deploy', 'skipped'], ['ci/legacy', 'pending'], ['ci/old', 'fail']]
  );
  assert.equal(checks[0].url, 'https://ci/1');
  assert.deepEqual(parseChecks(null), []);
});

test('the Copilot coding agent is recognised by its login', () => {
  for (const l of ['Copilot', 'app/copilot-swe-agent', 'copilot-swe-agent[bot]']) assert.ok(isCopilot(l), l);
  for (const l of ['copilot-fan', 'eliostruyf', 'dependabot[bot]']) assert.ok(!isCopilot(l), l);
});

test('a stack runs from the bottom PR up, through bases that are other PRs\' heads', () => {
  const p = (n: number, head: string, base: string) => ({ ...pr(n, 'x', base), headRefName: head });
  const prs = [p(1, 'feat/a', 'develop'), p(2, 'feat/b', 'feat/a'), p(3, 'feat/c', 'feat/b'), p(4, 'feat/d', 'feat/c'), p(9, 'other', 'develop')];
  const st = stackOf(prs, 3)!;
  assert.equal(st.base, 'develop');
  assert.deepEqual(st.prs.map((x) => x.number), [1, 2, 3, 4]);
  assert.equal(stackOf(prs, 9), null, 'a PR on its own is no stack');
  assert.deepEqual(stackOf(prs, 1)!.prs.map((x) => x.number), [1, 2, 3, 4]);
});

test('line comments GitHub cannot place go into the review text with their place', () => {
  assert.equal(foldComments('Summary', [{ path: 'src/a.ts', line: 4, side: 'RIGHT', body: 'Use the helper' }, { path: 'src/b.ts', line: 9, side: 'LEFT', body: 'Why remove this?' }]), 'Summary\n\n**`src/a.ts:4`**\nUse the helper\n\n**`src/b.ts:9`** (removed line)\nWhy remove this?');
});

test('a shared walkthrough reads well on GitHub and carries its data for other Hunkdory users', () => {
  const data = { version: 1, base: 'abc', chapters: [{ title: 'Retry', why: 'Flaky network', hunks: ['h:1234567'] }] };
  const body = walkthroughComment({ intent: 'Make sync retry.', chapters: [{ title: 'Retry', why: 'Flaky network', checks: ['Is 3 enough?'], files: ['src/retry.js'] }] }, data);
  assert.match(body, /## Review walkthrough\n\nMake sync retry\./);
  assert.match(body, /### 1\. Retry\n\nFlaky network\n\n- \[ \] Is 3 enough\?\n\nFiles: `src\/retry\.js`/);
  assert.deepEqual(readWalkthroughComment(body), data);
  assert.equal(readWalkthroughComment('Just a comment'), null);
  assert.equal(readWalkthroughComment('<!-- reviewer:data:bm90IGpzb24= -->'), null, 'needs the marker');
});

const raw = (over: Partial<RawPullRequest>): RawPullRequest => ({
  number: 7,
  title: 'Add export',
  headRefName: 'feat/export',
  headRefOid: 'abc',
  baseRefName: 'main',
  author: { login: 'alice', is_bot: false },
  isDraft: false,
  url: 'https://github.com/acme/app/pull/7',
  body: '',
  updatedAt: '2026-10-28T10:00:00Z',
  statusCheckRollup: null,
  ...over,
});

test('maps who is on a PR: assignees, requested users and teams, latest reviews', () => {
  const p = toPullRequest(
    raw({
      assignees: [{ login: 'dave' }],
      reviewRequests: [
        { __typename: 'User', login: 'carol' },
        // gh has given a team's slug as `slug` and as `login`; with or without the organization.
        { __typename: 'Team', slug: 'web', name: 'Web team', organization: { login: 'acme' } },
        { __typename: 'Team', login: 'platform', name: 'Platform', organization: { login: 'acme' } },
        { __typename: 'Team', name: 'docs' },
      ],
      latestReviews: [
        { author: { login: 'bob' }, state: 'APPROVED' },
        { author: { login: 'erin' }, state: 'CHANGES_REQUESTED' },
        { author: { login: 'frank' }, state: 'DISMISSED' },
        { author: null, state: 'COMMENTED' },
      ],
    })
  );
  assert.deepEqual(p.assignees, ['dave']);
  assert.deepEqual(p.requestedReviewers, ['carol', 'acme/web', 'acme/platform', 'docs']);
  assert.deepEqual(p.reviews, [
    { login: 'bob', state: 'APPROVED' },
    { login: 'erin', state: 'CHANGES_REQUESTED' },
  ]);
});

test('bots: a bot author is a bot, and review bots stay in the reviews like anyone', () => {
  const p = toPullRequest(raw({ author: { login: 'app/dependabot', is_bot: true }, reviewRequests: [{ __typename: 'Bot', login: 'copilot-pull-request-reviewer' }], latestReviews: [{ author: { login: 'copilot-pull-request-reviewer' }, state: 'COMMENTED' }] }));
  assert.equal(p.isBot, true);
  assert.equal(p.author, 'app/dependabot');
  assert.deepEqual(p.requestedReviewers, ['copilot-pull-request-reviewer']);
  assert.deepEqual(p.reviews, [{ login: 'copilot-pull-request-reviewer', state: 'COMMENTED' }]);
  assert.equal(toPullRequest(raw({ author: { login: 'copilot-swe-agent' } })).copilot, true);
});

test('a PR without an author (a deleted account) or people fields still maps', () => {
  const p = toPullRequest(raw({ author: null, assignees: null, reviewRequests: undefined, latestReviews: null }));
  assert.equal(p.author, 'unknown');
  assert.equal(p.isBot, false);
  assert.deepEqual([p.assignees, p.requestedReviewers, p.reviews], [[], [], []]);
});

test('a failed API call says what GitHub said, not just the status', () => {
  const stderr = 'gh: Unprocessable Entity (HTTP 422)\n';
  const own = apiErrorText(stderr, JSON.stringify({ message: 'Unprocessable Entity', errors: ['Review Can not approve your own pull request'], status: '422' }));
  assert.equal(own, 'Review Can not approve your own pull request');
  assert.ok(isOwnPrError(new Error(own)));
  assert.equal(apiErrorText(stderr, JSON.stringify({ message: 'Validation Failed', errors: [{ resource: 'Issue', code: 'custom', message: 'title is too long' }] })), 'title is too long');
  assert.equal(apiErrorText(stderr, JSON.stringify({ message: 'Not Found' })), 'gh: Unprocessable Entity (HTTP 422)');
  assert.equal(apiErrorText(stderr, ''), 'gh: Unprocessable Entity (HTTP 422)');
});

test('a failed fetch says why in a sentence, without the command and its refspecs', () => {
  const stderr = [
    'Command failed: git fetch --no-tags --quiet origin +refs/pull/2415/head:refs/reviewer/pr/2415 +refs/heads/develop/5.5:refs/reviewer/base/develop/5.5',
    'git@github.com: Permission denied (publickey).',
    'fatal: Could not read from remote repository.',
    '',
    'Please make sure you have the correct access rights',
    'and the repository exists.',
  ].join('\n');
  assert.match(fetchError(stderr, 'origin').message, /^Couldn't fetch the latest pull requests: GitHub turned down the SSH key for origin\./);
  assert.match(fetchError('ssh: Could not resolve host: github.com', 'origin').message, /can't be reached/);
  assert.match(fetchError('', 'origin', true).message, /longer than 2 minutes/);
  // Anything else: git's own reason, not the command line.
  assert.equal(fetchError('Command failed: git fetch origin +refs/x:refs/y\nfatal: refusing to fetch into branch', 'origin').message, "Couldn't fetch the latest pull requests: refusing to fetch into branch");
});

test('a push or fetch turned away at sign-in goes again through gh; other failures do not', () => {
  assert.ok(signInFailed('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'));
  assert.ok(signInFailed("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
  assert.ok(!signInFailed('! [rejected] feat/x -> feat/x (non-fast-forward)'));
  assert.ok(!signInFailed('ssh: Could not resolve host: github.com'));
});

test('the comment leads with what to look at, and each step gets its risk and the choices made', () => {
  const body = walkthroughComment(
    {
      intent: 'Add a cache.',
      beforeApproving: ['**Outside the request.** Step 2: Bump lint.', '**Touches auth or security.** token.js in step 1.'],
      chapters: [
        { title: 'Cache', why: 'Faster reads', risk: 'Stale entries', checks: ['Is a minute short enough?'], choices: [{ question: 'Where to keep it?', chose: 'In memory.', why: 'One instance only.', rejected: ['Redis: too much to run'] }] },
        { title: 'Lint', risk: 'Only the risk', checks: ['Only the risk'], choices: [{ question: 'Which rule?', chose: 'The strict one.', why: null, rejected: [] }] },
      ],
    },
    {}
  );
  assert.match(body, /Add a cache\.\n\n### Before approving\n\n- \*\*Outside the request\.\*\* Step 2: Bump lint\.\n- \*\*Touches auth or security\.\*\* token\.js in step 1\.\n\n<details>/);
  assert.match(body, /\*\*Risk:\*\* Stale entries/);
  assert.ok(!body.includes('**Risk:** Only the risk'), 'a risk asked as the question is not said twice');
  assert.match(body, /- Where to keep it\? In memory\. One instance only\. Set aside: Redis: too much to run\./);
  assert.match(body, /- Which rule\? The strict one\.\n/);

  assert.ok(!walkthroughComment({ chapters: [] }, {}).includes('Before approving'), 'nothing to look at, no heading');
});
