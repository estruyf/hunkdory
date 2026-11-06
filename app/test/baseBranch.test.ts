import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickBase, staleBase } from '../src/main/git.ts';
import { baseCandidates } from '../src/main/match.ts';

/** A repo where local `develop` is two commits behind `origin/develop`, and `feat/x` starts from origin's. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'hunkdory-base-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: root, encoding: 'utf8' }).trim();
  const commit = (name: string) => {
    writeFileSync(join(root, name), name);
    git('add', name);
    git('commit', '-m', name);
  };
  git('init', '-b', 'main');
  commit('one');
  git('branch', 'develop');
  commit('two');
  commit('three');
  git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
  git('branch', 'feat/x');
  return { root, git, commit, done: () => rmSync(root, { recursive: true, force: true }) };
}

const pick = (root: string, ...names: string[]) => pickBase(root, 'feat/x', baseCandidates('feat/x', names));

test("a branch cut from origin isn't charged for the commits your local base is missing", async () => {
  const r = setup();
  try {
    assert.equal((await pickBase(r.root, 'feat/x', ['develop'])).ahead, 2, 'what comparing with the local one alone counts');
    assert.deepEqual(await pick(r.root, 'develop'), { ref: 'origin/develop', ahead: 0 });
  } finally {
    r.done();
  }
});

test('a local base that has caught up keeps its name', async () => {
  const r = setup();
  try {
    r.git('update-ref', 'refs/heads/develop', 'refs/remotes/origin/develop');
    assert.deepEqual(await pick(r.root, 'develop'), { ref: 'develop', ahead: 0 });
  } finally {
    r.done();
  }
});

test('a local base with commits origin lacks wins when the branch was cut from them', async () => {
  const r = setup();
  try {
    r.git('checkout', '-q', 'feat/x');
    r.git('update-ref', 'refs/remotes/origin/develop', 'HEAD~1');
    r.git('update-ref', 'refs/heads/develop', 'HEAD');
    r.commit('four');
    assert.deepEqual(await pick(r.root, 'develop'), { ref: 'develop', ahead: 1 });
  } finally {
    r.done();
  }
});

test("a candidate without a copy on origin is simply skipped", async () => {
  const r = setup();
  try {
    assert.deepEqual(await pick(r.root, 'main'), { ref: 'main', ahead: 0 });
  } finally {
    r.done();
  }
});

test('a base you picked that is behind origin says how many commits are already there', async () => {
  const r = setup();
  try {
    const branch = { baseRef: 'develop', baseChosen: true, headRef: 'feat/x', uncommitted: false };
    assert.deepEqual(await staleBase(r.root, branch), { remote: 'origin/develop', commits: 2 });
  } finally {
    r.done();
  }
});

test('nothing to say about a base with no copy on origin, level with it, on origin, or an uncommitted review', async () => {
  const r = setup();
  try {
    const branch = { baseChosen: true, uncommitted: false, headRef: 'feat/x' };
    assert.equal(await staleBase(r.root, { ...branch, baseRef: 'main' }), null, 'no origin/main here');
    assert.equal(await staleBase(r.root, { ...branch, baseRef: 'origin/develop' }), null);
    assert.equal(await staleBase(r.root, { ...branch, baseRef: 'develop', baseChosen: false }), null, "Hunkdory's own pick already took the better one");
    assert.equal(await staleBase(r.root, { ...branch, baseRef: 'develop', uncommitted: true }), null);
    r.git('update-ref', 'refs/heads/develop', 'refs/remotes/origin/develop');
    assert.equal(await staleBase(r.root, { ...branch, baseRef: 'develop' }), null);
  } finally {
    r.done();
  }
});
