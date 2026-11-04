import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeThreads } from '../src/shared/threads.ts';
import { toFeedback, type RawFeedback } from '../src/main/github.ts';
import type { GitHubThread, HunkView } from '../src/shared/types.ts';

const hunk = (id: string, path: string, lines: HunkView['lines']): HunkView => ({
  id,
  path,
  oldPath: null,
  status: 'modified',
  untracked: false,
  synthetic: null,
  bucket: 'narrated',
  level: 'none',
  risks: [],
  added: 0,
  removed: 0,
  rangeLabel: '',
  lines,
  note: null,
});

const thread = (id: string, over: Partial<GitHubThread>): GitHubThread => ({
  id,
  path: 'src/a.ts',
  line: 11,
  startLine: null,
  side: 'RIGHT',
  resolved: false,
  outdated: false,
  comments: [{ id: `${id}c`, author: 'sam', body: 'Why?', at: '2026-11-01T10:00:00Z', url: 'https://github.com/o/r/pull/1#c' }],
  ...over,
});

const hunks = {
  h1: hunk('h1', 'src/a.ts', [
    { kind: 'ctx', oldN: 10, newN: 10, text: 'a' },
    { kind: 'del', oldN: 11, newN: null, text: 'b' },
    { kind: 'add', oldN: null, newN: 11, text: 'c' },
  ]),
  h2: hunk('h2', 'src/b.ts', [{ kind: 'add', oldN: null, newN: 3, text: 'x' }]),
};

test('a thread goes on the hunk with its file and its line on the same side', () => {
  const { byHunk, elsewhere } = placeThreads(
    [thread('right', {}), thread('left', { side: 'LEFT' }), thread('other', { path: 'src/b.ts', line: 3 })],
    hunks
  );
  assert.deepEqual(byHunk.get('h1')?.map((t) => t.id), ['right', 'left']);
  assert.deepEqual(byHunk.get('h2')?.map((t) => t.id), ['other']);
  assert.deepEqual(elsewhere, []);
});

test('outdated threads, lines no hunk shows, and removed-side comments on unchanged lines go elsewhere', () => {
  const { byHunk, elsewhere } = placeThreads(
    [thread('outdated', { line: null, outdated: true }), thread('far', { line: 400 }), thread('ctx-left', { side: 'LEFT', line: 10 }), thread('ctx', { line: 10 })],
    hunks
  );
  assert.deepEqual(byHunk.get('h1')?.map((t) => t.id), ['ctx']);
  assert.deepEqual(elsewhere.map((t) => t.id), ['outdated', 'far', 'ctx-left']);
});

test('GitHub feedback: reviews with something to say, and threads with their comments', () => {
  const raw: RawFeedback = {
    reviews: {
      nodes: [
        { author: { login: 'sam' }, state: 'COMMENTED', body: '', submittedAt: '2026-11-01T10:00:00Z', url: 'u1' },
        { author: { login: 'sam' }, state: 'CHANGES_REQUESTED', body: '', submittedAt: '2026-11-01T11:00:00Z', url: 'u2' },
        { author: null, state: 'COMMENTED', body: 'Looks off', submittedAt: '2026-11-01T12:00:00Z', url: 'u3' },
        { author: { login: 'me' }, state: 'PENDING', body: 'draft', submittedAt: null, url: 'u4' },
      ],
    },
    reviewThreads: {
      nodes: [
        { id: 't1', isResolved: false, isOutdated: true, path: 'a.ts', line: 5, startLine: null, diffSide: 'RIGHT', comments: { nodes: [{ id: 'c1', author: { login: 'sam' }, body: 'Hm', createdAt: 'x', url: 'cu' }] } },
        { id: 't2', isResolved: false, isOutdated: false, path: 'a.ts', line: 6, startLine: null, diffSide: 'RIGHT', comments: { nodes: [] } },
      ],
    },
  };
  const f = toFeedback(raw);
  // A comment-only review without words just holds line comments: those show as threads.
  assert.deepEqual(f.reviews.map((r) => [r.author, r.state]), [['sam', 'CHANGES_REQUESTED'], ['ghost', 'COMMENTED']]);
  assert.equal(f.threads.length, 1);
  assert.equal(f.threads[0]!.line, null);
  assert.equal(f.threads[0]!.outdated, true);
});
