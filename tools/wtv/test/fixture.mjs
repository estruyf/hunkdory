// Builds a small repo where an "agent" adds retry to sync, narrates that,
// and quietly does a few other things it doesn't mention.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

export function buildFixture(dir = mkdtempSync(join(tmpdir(), 'wtv-'))) {
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.email', 'demo@example.com');
  run(dir, 'config', 'user.name', 'Demo');

  write(dir, {
    'package.json': JSON.stringify({ name: 'demo', type: 'module', dependencies: { kleur: '^4.1.5' } }, null, 2) + '\n',
    'src/sync.js': `export async function sync(client, items) {
  for (const item of items) {
    await client.push(item);
  }
  return items.length;
}
`,
    'src/auth/token.js': `export const TOKEN_EXPIRY_SECONDS = 3600;

export function isExpired(issuedAt, now = Date.now()) {
  return now - issuedAt > TOKEN_EXPIRY_SECONDS * 1000;
}
`,
    'src/format.js': `export function formatCount(n) { return \`\${n} items\`; }
`,
    'test/sync.test.js': `import { sync } from '../src/sync.js';

test('pushes every item', async () => {
  const pushed = [];
  const n = await sync({ push: async (i) => pushed.push(i) }, [1, 2]);
  expect(n).toBe(2);
  expect(pushed).toEqual([1, 2]);
});
`,
  });
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'base');
  const base = run(dir, 'rev-parse', 'HEAD');

  run(dir, 'checkout', '-qb', 'agent');
  write(dir, {
    // Narrated: new dependency for logging
    'package.json': JSON.stringify({ name: 'demo', type: 'module', dependencies: { kleur: '^4.1.5', 'p-limit': '^6.1.0' } }, null, 2) + '\n',
    // Narrated: retry helper
    'src/retry.js': `export async function withRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 2 ** i * 100));
    }
  }
}
`,
    // Narrated: sync uses retry
    'src/sync.js': `import { withRetry } from './retry.js';

export async function sync(client, items) {
  for (const item of items) {
    await withRetry(() => client.push(item));
  }
  return items.length;
}
`,
    // NOT narrated: token lifetime silently raised to 24h
    'src/auth/token.js': `export const TOKEN_EXPIRY_SECONDS = 86400;

export function isExpired(issuedAt, now = Date.now()) {
  return now - issuedAt > TOKEN_EXPIRY_SECONDS * 1000;
}
`,
    // NOT narrated, but only formatting: should be ignored as noise
    'src/format.js': `export function formatCount(n) {
  return \`\${n} items\`;
}
`,
    // NOT narrated: an assertion quietly removed to make a test pass
    'test/sync.test.js': `import { sync } from '../src/sync.js';

test('pushes every item', async () => {
  const pushed = [];
  const n = await sync({ push: async (i) => pushed.push(i) }, [1, 2]);
  expect(n).toBe(2);
});
`,
  });
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'Add retry to sync');
  const head = run(dir, 'rev-parse', 'HEAD');

  // NOT narrated and not even committed: a leftover debug script
  write(dir, { 'scratch.js': `import { sync } from './src/sync.js';\nconsole.log(await sync({ push: async () => {} }, [1]));\n` });

  // The agent's walkthrough. Note the phantom ref to a file that doesn't exist.
  const walkthrough = {
    version: 1,
    intent: 'Retry failed pushes during sync so flaky networks stop breaking it',
    base,
    head,
    chapters: [
      {
        title: 'Retry helper',
        why: 'Generic retry with exponential backoff, 3 attempts',
        hunks: ['src/retry.js', 'src/sync/backoff.js'],
      },
      {
        title: 'Use retry in sync',
        why: 'Each push is wrapped so one flaky call no longer fails the whole sync',
        hunks: ['src/sync.js:1-6'],
      },
      {
        title: 'Concurrency dependency',
        why: 'p-limit for the follow-up that parallelises pushes',
        hunks: ['package.json:5'],
      },
    ],
  };
  write(dir, { '.review/walkthrough.json': JSON.stringify(walkthrough, null, 2) + '\n' });

  return { dir, base, head };
}
