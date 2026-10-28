import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessHunk } from '../src/risk.mjs';

const hunk = (path, added, removed = [], over = {}) => ({ path, added, removed, newStart: 10, oldStart: 10, status: 'modified', whitespaceOnly: false, lockfile: false, synthetic: null, ...over });
const risk = (h, code) => assessHunk(h).risks.find((r) => r.code === code);

test('a package.json version bump is not a dependency change', () => {
  const h = hunk('apps/web/package.json', ['  "version": "1.4.0",'], ['  "version": "1.3.9",']);
  assert.equal(risk(h, 'deps'), undefined);
  assert.deepEqual(risk(h, 'version'), { code: 'version', severity: 'low', label: 'Version bumped', match: { term: '"version": "1.4.0"', line: 10 } });
  assert.equal(assessHunk(h).level, 'low');
});

test('a real dependency line still is, and says which line', () => {
  const h = hunk('package.json', ['  "version": "2.0.0",', '  "p-limit": "^6.1.0",']);
  assert.deepEqual(risk(h, 'deps')?.match, { term: '"p-limit": "^6.1.0",', line: 11 });
  assert.equal(risk(h, 'version'), undefined);
});

test('security words in comments are ignored', () => {
  const h = hunk('src/ui-toggle.ts', [' * the only state where the visitor role changes what is shown.', '// token refresh happens elsewhere', 'export const x = 1;']);
  assert.equal(risk(h, 'security'), undefined);
});

test('weak security words are worth a look, strong ones are high risk', () => {
  const weak = risk(hunk('src/a.ts', ['const x = 1;', 'if (user.role === "admin") show();']), 'security');
  assert.equal(weak.severity, 'medium');
  assert.deepEqual(weak.match, { term: 'role', line: 11 });
  const strong = risk(hunk('src/a.ts', ['const token = await refresh();']), 'security');
  assert.equal(strong.severity, 'high');
  assert.deepEqual(strong.match, { term: 'token', line: 10 });
});

test('author and crypto.randomUUID are not security', () => {
  assert.equal(risk(hunk('src/a.ts', ['const author = commit.author;', 'const id = crypto.randomUUID();']), 'security'), undefined);
});

test('a security word in the path is high risk with no line', () => {
  const r = risk(hunk('src/auth/token.js', ['export const X = 1;']), 'security');
  assert.equal(r.severity, 'high');
  assert.deepEqual(r.match, { term: 'auth', line: null });
});

test('removed lines report their old line number', () => {
  const r = risk(hunk('src/a.ts', [], ['try { go(); }', 'const secret = env.KEY;'], { oldStart: 40 }), 'security');
  assert.deepEqual(r.match, { term: 'secret', line: 41 });
});

test('re.exec and role attributes are not risks', () => {
  const h = hunk('src/a.tsx', ['const m = PATTERN.exec(text);', '<div role="button" tabIndex={0} />', "<li role={'option'} />"]);
  assert.equal(risk(h, 'exec'), undefined);
  assert.equal(risk(h, 'security'), undefined);
  assert.ok(risk(hunk('src/a.ts', ['exec(`rm -rf ${dir}`);']), 'exec'));
});
