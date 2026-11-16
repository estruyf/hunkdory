import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLink, isAbsoluteFolder, isSeshboardLink, linkInArgv, parseLink, projectFor, seshboardLink, type ReviewLink } from '../src/main/links.ts';
import { isBranchName } from '../src/main/git.ts';

const review = (repo: string, branch: string) => `hunkdory://review?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}`;
const reason = (url: string, platform: NodeJS.Platform = 'darwin') => {
  const p = parseLink(url, platform);
  return p.ok ? null : p.reason;
};

test('a review link names a folder and a branch', () => {
  assert.deepEqual(parseLink(review('/Users/me/dev/web', 'claude/fix-login'), 'darwin'), { ok: true, link: { kind: 'review', repo: '/Users/me/dev/web', branch: 'claude/fix-login' } });
  // Spaces, and a trailing slash after the screen.
  assert.deepEqual(parseLink('hunkdory://review/?repo=/Users/me/My%20Projects/web&branch=feat/a', 'darwin'), { ok: true, link: { kind: 'review', repo: '/Users/me/My Projects/web', branch: 'feat/a' } });
  assert.deepEqual(parseLink(review('C:\\Users\\me\\dev\\web', 'feat/a'), 'win32'), { ok: true, link: { kind: 'review', repo: 'C:\\Users\\me\\dev\\web', branch: 'feat/a' } });
});

test('a link that is not a review link is refused', () => {
  for (const url of ['not a link', 'https://example.com/review?repo=/a&branch=b', 'hunkdory://merge?repo=/a&branch=b', 'hunkdory://review/push?repo=/a&branch=b', 'hunkdory:review?repo=/a&branch=b']) {
    assert.ok(reason(url), url);
  }
});

test('a link without exactly one repo and one branch is refused', () => {
  assert.match(reason('hunkdory://review?branch=b')!, /repo/);
  assert.match(reason('hunkdory://review?repo=/a')!, /branch/);
  assert.match(reason('hunkdory://review?repo=/a&branch=')!, /branch/);
  assert.match(reason('hunkdory://review?repo=/a&repo=/b&branch=x')!, /one repo/);
  assert.match(reason('hunkdory://review?repo=/a&branch=x&branch=y')!, /one branch/);
});

test('a relative path is refused', () => {
  for (const repo of ['dev/web', './web', '../web', '~/dev/web']) assert.match(reason(review(repo, 'b'))!, /full path/, repo);
});

test('on Windows only a path with a drive letter counts, never a network path', () => {
  assert.ok(isAbsoluteFolder('C:\\dev\\web', 'win32'));
  assert.ok(isAbsoluteFolder('d:/dev/web', 'win32'));
  for (const p of ['\\\\attacker\\share', '//attacker/share', '\\\\?\\C:\\dev', '\\dev\\web', 'C:dev', 'dev\\web']) assert.equal(isAbsoluteFolder(p, 'win32'), false, p);
  assert.equal(isAbsoluteFolder('C:\\dev', 'darwin'), false);
});

test('a branch that would read as an option or a reflog entry is refused before git sees it', () => {
  for (const b of ['-D', '--force', '@', '@{-1}', 'main@{upstream}']) assert.match(reason(review('/a', b))!, /isn't a branch name/, b);
});

test('checkLink refuses a missing folder and a branch name git rejects', async () => {
  const link: ReviewLink = { kind: 'review', repo: '/a', branch: 'feat/a' };
  const ok = { isFolder: () => true, branchName: async () => true };
  assert.equal(await checkLink(link, ok), null);
  assert.match((await checkLink(link, { ...ok, isFolder: () => false }))!, /no folder at \/a/);
  assert.match((await checkLink(link, { ...ok, branchName: async () => false }))!, /feat\/a isn't a branch name/);
});

test('git check-ref-format decides what a branch name is', async () => {
  for (const b of ['main', 'feat/a', 'claude/fix-login-123', 'origin/feat/a']) assert.equal(await isBranchName(b), true, b);
  for (const b of ['a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', 'feat/', '/feat', 'a.lock', 'a//b', '-x', 'HEAD']) assert.equal(await isBranchName(b), false, b);
});

test('the link Windows passes along is found among the arguments', () => {
  assert.equal(linkInArgv(['C:\\Program Files\\Hunkdory\\Hunkdory.exe', '--allow-file-access', 'hunkdory://review?repo=C:%5Ca&branch=b']), 'hunkdory://review?repo=C:%5Ca&branch=b');
  assert.equal(linkInArgv(['Hunkdory.exe', 'HUNKDORY://review?repo=x&branch=b']), 'HUNKDORY://review?repo=x&branch=b');
  assert.equal(linkInArgv(['Hunkdory.exe', '.', '--inspect']), null);
});

test('a folder belongs to the project whose folder or worktree it is, or is inside', () => {
  const projects = [
    { id: 'web', folders: ['/Users/me/dev/web', '/Users/me/dev/web-worktrees/feat-a'] },
    { id: 'nested', folders: ['/Users/me/dev/web/packages/ui'] },
  ];
  assert.equal(projectFor('/Users/me/dev/web', projects, 'darwin'), 'web');
  assert.equal(projectFor('/Users/me/dev/web-worktrees/feat-a', projects, 'darwin'), 'web');
  assert.equal(projectFor('/Users/me/dev/web/.claude/worktrees/x', projects, 'darwin'), 'web');
  // A project inside another one wins for its own folder.
  assert.equal(projectFor('/Users/me/dev/web/packages/ui/src', projects, 'darwin'), 'nested');
  // A folder that only starts with the same letters is another folder.
  assert.equal(projectFor('/Users/me/dev/web2', projects, 'darwin'), null);
  assert.equal(projectFor('/Users/me/dev', projects, 'darwin'), null);
  // Windows: case and slashes don't matter.
  assert.equal(projectFor('c:\\Dev\\Web\\', [{ id: 'w', folders: ['C:/dev/web'] }], 'win32'), 'w');
});

test('a link to a folder that is there resolves through the real file system', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-links-'));
  try {
    const link: ReviewLink = { kind: 'review', repo: dir, branch: 'feat/a' };
    const real = { isFolder: (p: string) => p === dir, branchName: (b: string) => isBranchName(b) };
    assert.equal(await checkLink(link, real), null);
    assert.match((await checkLink({ ...link, repo: join(dir, 'gone') }, real))!, /no folder/);
    assert.match((await checkLink({ ...link, branch: 'a..b' }, real))!, /isn't a branch name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Hunkdory opens a Seshboard session link and nothing else', () => {
  const id = '3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d';
  assert.equal(seshboardLink(id), `seshboard://session/${id}`);
  assert.ok(isSeshboardLink(`seshboard://session/${id}`));
  assert.ok(isSeshboardLink(`seshboard://session/${id.toUpperCase()}`));
  for (const url of [
    'seshboard://session/not-a-uuid',
    `seshboard://session/${id}/run`,
    `seshboard://session/${id}?cmd=rm`,
    `seshboard://session/${id}#x`,
    `seshboard://settings/${id}`,
    `seshboard://session/`,
    `file:///etc/passwd`,
    `vscode://session/${id}`,
    `seshboard:session/${id}`,
  ]) {
    assert.equal(isSeshboardLink(url), false, url);
  }
});
