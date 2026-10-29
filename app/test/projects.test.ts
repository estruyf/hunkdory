import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectName, Store, toWatch, withProjectName } from '../src/main/store.ts';
import type { Project } from '../src/shared/types.ts';

test('a project name is trimmed, and empty means the folder name', () => {
  assert.equal(projectName('  Web (client)  ', '/code/web'), 'Web (client)');
  assert.equal(projectName('', '/code/web'), 'web');
  assert.equal(projectName('   ', '/code/web'), 'web');
  assert.equal(projectName(undefined, '/code/web'), 'web');
});

test('renaming a project keeps its reviews and ignored branches, and clearing the name brings the folder back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-rename-'));
  try {
    const store = new Store(join(dir, 'store.json'));
    const p: Project = { id: 'p1', name: projectName(' Client web ', '/code/web'), path: '/code/web', baseBranch: 'main', remote: null, watch: { anyBranch: true, pattern: null, pullRequests: false }, github: null, addedAt: '2026-10-29T08:00:00Z', ignored: ['feat/old'] };
    assert.equal(p.name, 'Client web');
    store.addProject(p);
    store.ensureReview(p.id, 'feat/x', { title: 'X' });

    store.addProject(withProjectName(store.project(p.id), 'Marketing site'));
    assert.equal(store.project(p.id).name, 'Marketing site');
    assert.equal(store.projects().length, 1, 'renamed in place, not added');
    assert.equal(store.review(p.id, 'feat/x')?.title, 'X');
    assert.deepEqual(store.project(p.id).ignored, ['feat/old']);

    assert.equal(withProjectName(store.project(p.id), undefined).name, 'Marketing site', 'left out: kept');
    store.addProject(withProjectName(store.project(p.id), ''));
    // Kept on disk, not just in memory.
    assert.equal(new Store(join(dir, 'store.json')).project(p.id).name, 'web');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two projects may share a name: the path tells them apart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-rename-'));
  try {
    const store = new Store(join(dir, 'store.json'));
    const base = { baseBranch: 'main', remote: null, watch: { anyBranch: true, pattern: null, pullRequests: false }, github: null, addedAt: '2026-10-29T08:00:00Z' };
    store.addProject({ ...base, id: 'a', name: 'web', path: '/work/web' });
    store.addProject({ ...base, id: 'b', name: 'web', path: '/home/web' });
    assert.deepEqual(store.projects().map((x) => x.id), ['a', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watch rules from before you could combine them become the same rule as switches', () => {
  assert.deepEqual(toWatch({ mode: 'agent-sessions' }), { anyBranch: true, pattern: null, pullRequests: false });
  assert.deepEqual(toWatch({ mode: 'pattern', pattern: 'claude/*' }), { anyBranch: false, pattern: 'claude/*', pullRequests: false });
  assert.deepEqual(toWatch({ mode: 'pull-requests' }), { anyBranch: false, pattern: null, pullRequests: true });
  assert.deepEqual(toWatch(undefined), { anyBranch: true, pattern: null, pullRequests: false });
  assert.deepEqual(toWatch({ agentSessions: true, pattern: null, pullRequests: true }), { anyBranch: true, pattern: null, pullRequests: true });
  const mixed = { anyBranch: true, pattern: 'feat/*', pullRequests: true };
  assert.deepEqual(toWatch(mixed), mixed);
});

test('an old store loads with its watch rule as switches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-watch-'));
  try {
    const file = join(dir, 'store.json');
    const old = { id: 'p1', name: 'web', path: '/code/web', baseBranch: 'main', remote: null, watch: { mode: 'pattern', pattern: 'claude/*' }, github: null, addedAt: '2026-10-29T08:00:00Z' };
    writeFileSync(file, JSON.stringify({ version: 1, projects: [old], reviews: {} }));
    assert.deepEqual(new Store(file).project('p1').watch, { anyBranch: false, pattern: 'claude/*', pullRequests: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
