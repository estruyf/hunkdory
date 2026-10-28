import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrationBranches, matchesPattern, matchSessions, withCheckoutFallback } from '../src/main/match.ts';
import type { SessionInfo } from '../src/shared/types.ts';

const session = (id: string, startedAt: string, branches: [string, string, string?][], originalBranch: string | null = null): SessionInfo => ({
  id,
  file: `/${id}.jsonl`,
  configDir: '/home/.claude',
  cwd: '/repo',
  branches: branches.map(([name, lastSeen, firstSeen]) => ({ name, firstSeen: firstSeen ?? lastSeen, lastSeen })),
  originalBranch,
  worktreePath: null,
  firstPrompt: `prompt ${id}`,
  title: null,
  startedAt,
  endedAt: branches.at(-1)?.[1] ?? startedAt,
});

const a = session('a', '2026-10-01T10:00:00Z', [['main', '2026-10-01T10:01:00Z'], ['feat/x', '2026-10-01T11:00:00Z']]);
const b = session('b', '2026-10-02T09:00:00Z', [['feat/x', '2026-10-02T09:30:00Z']], 'dev');
const c = session('c', '2026-10-03T09:00:00Z', [['feat/gone', '2026-10-03T09:30:00Z'], ['fix/y', '2026-10-03T10:00:00Z']]);
const all = [a, b, c];
const exists = (name: string) => name !== 'feat/gone';

test('groups sessions by every branch they ran on', () => {
  const m = matchSessions(all, { exists, exclude: new Set(['main']) });
  assert.deepEqual([...m.keys()].sort(), ['feat/x', 'fix/y']);
});

test('resumes the most recent session but takes the prompt from the first one', () => {
  const x = matchSessions(all, { exists, exclude: new Set(['main']) }).get('feat/x')!;
  assert.deepEqual(x.sessions.map((s) => s.id), ['b', 'a']);
  assert.equal(x.origin.id, 'a');
  assert.equal(x.lastSeen, '2026-10-02T09:30:00Z');
});

test('the prompt comes from the session where the branch first appeared, not the oldest session', () => {
  // An old session that wandered onto the branch late, and the one that made it.
  const wanderer = session('old', '2026-09-01T10:00:00Z', [['feat/z', '2026-10-05T12:00:00Z', '2026-10-05T11:00:00Z']]);
  const maker = session('maker', '2026-10-04T09:00:00Z', [['feat/z', '2026-10-04T10:00:00Z', '2026-10-04T09:05:00Z']]);
  const z = matchSessions([wanderer, maker], { exists: () => true, exclude: new Set() }).get('feat/z')!;
  assert.equal(z.origin.id, 'maker');
  assert.equal(z.sessions[0].id, 'old', 'resume still goes to the most recent one');
});

test('drops deleted branches and integration branches', () => {
  const exclude = integrationBranches(all, 'origin/main');
  assert.ok(exclude.has('main') && exclude.has('dev') && exclude.has('origin/main'));
  const m = matchSessions(all, { exists, exclude });
  assert.ok(!m.has('feat/gone'));
  assert.ok(!m.has('main'));
});

test('matches branch patterns like the Connect screen shows them', () => {
  assert.ok(matchesPattern('claude/fix-login', 'claude/*, copilot/*'));
  assert.ok(matchesPattern('copilot/orders', 'claude/*, copilot/*'));
  assert.ok(!matchesPattern('claude/a/b', 'claude/*'));
  assert.ok(matchesPattern('claude/a/b', 'claude/**'));
  assert.ok(!matchesPattern('feature/claude', 'claude/*'));
  assert.ok(matchesPattern('fix.1', 'fix.?'));
});

test('a session that only saw "HEAD" belongs to the branch checked out where it ran', () => {
  const blind = { ...session('d', '2026-10-28T09:00:00Z', []), cwd: '/repo/app/src' };
  const inWorktree = { ...session('e', '2026-10-28T09:00:00Z', []), cwd: '/repo/.claude/worktrees/x' };
  const onMain = { ...session('f', '2026-10-28T09:00:00Z', []), cwd: '/other' };
  const trees = [
    { path: '/repo', branch: 'claude/phase1' },
    { path: '/repo/.claude/worktrees/x', branch: 'worktree-x' },
    { path: '/other', branch: 'main' },
  ];
  const [d, e, f, kept] = withCheckoutFallback([blind, inWorktree, onMain, a], trees, new Set(['main']));
  assert.deepEqual(d.branches.map((b) => b.name), ['claude/phase1']);
  assert.deepEqual(e.branches.map((b) => b.name), ['worktree-x'], 'the deepest checkout wins');
  assert.deepEqual(f.branches, [], 'never attributed to an integration branch');
  assert.equal(kept, a, 'sessions that recorded branches are left alone');
});
