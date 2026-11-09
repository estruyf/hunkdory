import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { Actions, actsOnCode, changedSinceSeen, sendBackPrompt } from '../src/main/actions.ts';
import { notOnBranch } from '../src/main/git.ts';
import { shellEnv, which } from '../src/main/shellEnv.ts';
import type { Projects } from '../src/main/projects.ts';
import type { Store } from '../src/main/store.ts';
import type { FinishRequest, ReviewData, ReviewState } from '../src/shared/types.ts';
import { thisComputer } from '../src/shared/platform.ts';

// A send-back starts the agent's CLI. A stand-in `claude` that writes down what it was asked and stops comes first on the
// PATH, for this whole file: the shell's environment is read once, so it has to be there before any test reads it.
const temp: string[] = [];
const tempDir = (name: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), name)));
  temp.push(dir);
  return dir;
};
after(() => temp.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const fake = tempDir('hunkdory-fake-claude-');
const claudeAsked = join(fake, 'args.txt');
writeFileSync(join(fake, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${claudeAsked}.tmp"\nmv "${claudeAsked}.tmp" "${claudeAsked}"\n`);
chmodSync(join(fake, 'claude'), 0o755);
process.env.SHELL = '/usr/bin/false';
process.env.PATH = `${fake}${delimiter}${process.env.PATH}`;

/** What the stand-in was asked, once it has run. */
async function asked() {
  for (let i = 0; i < 200 && !existsSync(claudeAsked); i++) await new Promise((r) => setTimeout(r, 25));
  const args = readFileSync(claudeAsked, 'utf8');
  rmSync(claudeAsked);
  return args;
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** A repo on main, with a branch `feat` one commit ahead of it. */
function repo() {
  const root = tempDir('hunkdory-actions-');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'one\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'first');
  git(root, 'checkout', '-q', '-b', 'feat');
  writeFileSync(join(root, 'b.txt'), 'reviewed\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'the change you reviewed');
  const reviewed = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', 'main');
  return { root, reviewed };
}

const review = () => ({ projectId: 'p', branch: 'feat', comments: [], reviewed: {} }) as unknown as ReviewState;

function actions(root: string, data: Partial<ReviewData>, over: Partial<Projects> = {}) {
  const r = review();
  const store = { project: () => ({ github: null }), ensureReview: () => r, updateReview: (_p: string, _b: string, fn: (x: ReviewState) => void) => (fn(r), r) } as unknown as Store;
  const full = { title: 'T', files: 1, added: 1, removed: 0, steps: [], hunks: { h1: {} }, session: null, dirty: false, dirtyFiles: 0, ahead: 0, ...data } as unknown as ReviewData;
  const projects = {
    review: async () => full,
    find: async () => ({ project: { path: root }, d: { branch: { pr: null, baseRef: 'main', checkout: { kind: 'none' }, dirtyFiles: 0 } } }),
    pullRequest: async () => {
      throw new Error('reached GitHub');
    },
    ...over,
  } as unknown as Projects;
  return new Actions({ store, projects, logDir: join(root, '.git', 'logs-test'), wtvBin: 'wtv.mjs', onChange: () => {} });
}

const req = (over: Partial<FinishRequest>): FinishRequest => ({ projectId: 'p', branch: 'feat', kind: 'merge', note: '', dropStepKeys: [], seen: { headSha: 'sha', hunkIds: ['h1'] }, ...over });

test('a branch has changed when it has new commits or different uncommitted edits, not when the hunks only come in another order', () => {
  const seen = { headSha: 'a', hunkIds: ['h1', 'h2'] };
  assert.equal(changedSinceSeen(seen, { headSha: 'a', hunks: { h2: {}, h1: {} } } as never), false);
  assert.equal(changedSinceSeen(seen, { headSha: 'b', hunks: { h1: {}, h2: {} } } as never), true, 'a new commit');
  assert.equal(changedSinceSeen(seen, { headSha: 'a', hunks: { h1: {}, h3: {} } } as never), true, 'an edit swapped');
  assert.equal(changedSinceSeen(seen, { headSha: 'a', hunks: { h1: {} } } as never), true, 'an edit gone');
  assert.equal(changedSinceSeen(seen, { headSha: 'a', hunks: { h1: {}, h2: {}, h3: {} } } as never), true, 'an edit added');
});

test('merging, approving and deleting act on the code as it is; commenting and closing a review do not', () => {
  assert.equal(actsOnCode({ kind: 'merge' }), true);
  assert.equal(actsOnCode({ kind: 'github', event: 'APPROVE' }), true);
  assert.equal(actsOnCode({ kind: 'discard', deleteBranch: true }), true);
  assert.equal(actsOnCode({ kind: 'github', event: 'COMMENT' }), false);
  assert.equal(actsOnCode({ kind: 'github', event: 'REQUEST_CHANGES' }), false);
  assert.equal(actsOnCode({ kind: 'discard' }), false);
  assert.equal(actsOnCode({ kind: 'send-back' }), false);
});

test('a merge stops when the branch moved after the page was read, and main stays where it was', async () => {
  const { root, reviewed } = repo();
  const before = git(root, 'rev-parse', 'main');
  const res = await actions(root, { headSha: 'a-commit-you-never-saw' }).finish(req({ seen: { headSha: reviewed, hunkIds: ['h1'] } }));
  assert.equal(res.ok, false);
  assert.equal(res.changed, true);
  assert.equal(git(root, 'rev-parse', 'main'), before);
});

test('a merge stops when the uncommitted edits changed, even on the same commit', async () => {
  const { root, reviewed } = repo();
  const res = await actions(root, { headSha: reviewed, hunks: { h1: {}, h2: {} } as never }).finish(req({ seen: { headSha: reviewed, hunkIds: ['h1'] } }));
  assert.equal(res.changed, true);
});

test('a merge takes the commit you reviewed, not one that landed on the branch since', async () => {
  const { root, reviewed } = repo();
  git(root, 'checkout', '-q', 'feat');
  writeFileSync(join(root, 'c.txt'), 'never reviewed\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'landed during the merge');
  const late = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', 'main');
  const res = await actions(root, { headSha: reviewed }).finish(req({ seen: { headSha: reviewed, hunkIds: ['h1'] } }));
  assert.equal(res.ok, true, res.message);
  git(root, 'merge-base', '--is-ancestor', reviewed, 'main');
  assert.throws(() => git(root, 'merge-base', '--is-ancestor', late, 'main'), 'the late commit stays out of main');
});

test('deleting a branch stops when it has commits you did not see; closing the review does not', async () => {
  const { root, reviewed } = repo();
  const stale = { headSha: 'older', hunkIds: ['h1'] };
  const deleting = await actions(root, { headSha: reviewed }).finish(req({ kind: 'discard', deleteBranch: true, seen: stale }));
  assert.equal(deleting.changed, true);
  git(root, 'rev-parse', '--verify', 'feat');
  const closing = await actions(root, { headSha: reviewed }).finish(req({ kind: 'discard', seen: stale }));
  assert.equal(closing.ok, true);
});

test('approving stops when the PR moved; a comment still goes ahead', async () => {
  const { root } = repo();
  const stale = { headSha: 'older', hunkIds: ['h1'] };
  const approve = await actions(root, { headSha: 'newer' }).finish(req({ kind: 'github', event: 'APPROVE', seen: stale }));
  assert.equal(approve.changed, true);
  const comment = await actions(root, { headSha: 'newer' }).finish(req({ kind: 'github', event: 'COMMENT', seen: stale }));
  assert.equal(comment.changed, undefined);
  assert.equal(comment.message, 'reached GitHub');
});

test('a PR with work only on this Mac is not merged, before anything is posted', async () => {
  const { root } = repo();
  const pr = { number: 7 } as ReviewData['pr'];
  const seen = { headSha: 'sha', hunkIds: ['h1'] };
  const dirty = await actions(root, { headSha: 'sha', pr, dirty: true, dirtyFiles: 2 }).finish(req({ seen }));
  assert.equal(dirty.ok, false);
  assert.match(dirty.message, new RegExp(`2 uncommitted files on ${thisComputer(process.platform)} aren't on PR #7`));
  const ahead = await actions(root, { headSha: 'sha', pr, ahead: 1 }).finish(req({ seen }));
  assert.match(ahead.message, new RegExp(`1 unpushed commit on ${thisComputer(process.platform)} isn't on PR #7`));
  const clean = await actions(root, { headSha: 'sha', pr }).finish(req({ seen }));
  assert.equal(clean.message, 'reached GitHub', 'a clean PR goes on to GitHub');
});

test('an agent only edits from a folder on the branch', async () => {
  const { root } = repo();
  assert.match((await notOnBranch(root, 'feat'))!, /is on "main" now/);
  assert.equal(await notOnBranch(root, 'main'), null);
  git(root, 'checkout', '-q', '--detach');
  assert.match((await notOnBranch(root, 'main'))!, /a detached HEAD/);
});

test('sending back stops when the session\'s folder moved to another branch, before the agent starts', async () => {
  const { root } = repo();
  const session = { id: 's', cwd: root, agent: 'claude-code' } as ReviewData['session'];
  const res = await actions(root, { headSha: 'sha', session, assistant: { id: 'claude-code', name: 'Claude Code' } }).finish(req({ kind: 'send-back', note: 'Fix it' }));
  assert.equal(res.ok, false);
  assert.match(res.message, /is on "main" now, so an agent working there wouldn't change feat/);
});

test('sending back only asks for a walkthrough file when the agent keeps one', () => {
  const data = { steps: [] };
  const state = { comments: [] };
  const fb = { note: 'Thanks', dropStepKeys: [] };
  assert.match(sendBackPrompt(data, state, fb, { verify: 'wtv verify' }), /update \.review\/walkthrough\.json[\s\S]*wtv verify/);
  const noCheck = sendBackPrompt(data, state, fb, { verify: null });
  assert.match(noCheck, /update \.review\/walkthrough\.json so it describes the branch as it is now\.$/, 'without a way to run the check here, the agent is not told to');
  const without = sendBackPrompt(data, state, fb, null);
  assert.doesNotMatch(without, /walkthrough/);
  assert.match(without, /Note: Thanks$/);
});

// On Windows only a claude.exe is started (shellEnv.ts → which), and the stand-in is a shell script.
const fakeRuns = process.platform === 'win32' ? 'the stand-in claude is a shell script, which Windows does not start' : false;

test('a send-back only has the agent keep a walkthrough file when it already keeps one', { skip: fakeRuns }, async () => {
  // Never the real one: this must not start an agent.
  assert.equal(await which('claude', await shellEnv()), join(fake, 'claude'));
  const { root } = repo();
  git(root, 'checkout', '-q', 'feat');
  const session = { id: 's', cwd: root, agent: 'claude-code' } as ReviewData['session'];
  const send = (walkthrough: ReviewData['walkthrough']) => actions(root, { headSha: 'sha', session, walkthrough, assistant: { id: 'claude-code', name: 'Claude Code' } }).finish(req({ kind: 'send-back', note: 'Fix it' }));

  for (const walkthrough of ['reviewer', 'skeleton'] as const) {
    const res = await send(walkthrough);
    assert.equal(res.ok, true, res.message);
    const args = await asked();
    assert.match(args, /Note: Fix it/);
    assert.doesNotMatch(args, /walkthrough\.json/, walkthrough);
    assert.doesNotMatch(args, /wtv/, `${walkthrough}: no verifier to run, so none is allowed`);
  }

  assert.equal((await send('agent')).ok, true);
  const args = await asked();
  assert.match(args, /update \.review\/walkthrough\.json/);
  assert.match(args, /Bash\(.*wtv/);
});
