import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandHome, pathKey } from '../src/main/paths.ts';

test('a saved project path and a session folder match with ~, trailing slashes and ..', () => {
  const home = '/Users/me';
  assert.equal(expandHome('~/dev/web', home), '/Users/me/dev/web');
  assert.equal(expandHome('/srv/~/web', home), '/srv/~/web');
  // Folders that don't exist compare by their resolved path.
  const key = pathKey('/Users/me/dev/web', home);
  for (const p of ['~/dev/web', '~/dev/web/', '/Users/me/dev/web//', '/Users/me/dev/x/../web', ' ~/dev/web ']) assert.equal(pathKey(p, home), key, p);
  assert.notEqual(pathKey('~/dev/web2', home), key);
});

test('a symlinked folder is the folder it points at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkdory-paths-'));
  try {
    mkdirSync(join(dir, 'real'));
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
    assert.equal(pathKey(join(dir, 'link/')), pathKey(join(dir, 'real')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
