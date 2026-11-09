import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandHome, gitPath, pathKey } from '../src/main/paths.ts';
import { withUpperCasePath } from '../src/main/shellEnv.ts';
import { thisComputer } from '../src/shared/platform.ts';

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

test('on Windows, ~ takes a backslash too, and session paths compare in the form git writes them', () => {
  assert.equal(expandHome('~\\dev\\web', 'C:\\Users\\me', 'win32'), 'C:\\Users\\me\\dev\\web');
  assert.equal(expandHome('~\\dev', '/Users/me', 'darwin'), '~\\dev', 'a backslash is part of a name on macOS');
  assert.equal(gitPath('C:\\Users\\me\\dev\\web', 'win32'), 'C:/Users/me/dev/web');
  assert.equal(gitPath('/Users/me/a\\b', 'darwin'), '/Users/me/a\\b');
});

test("Windows's Path is PATH in a copy of the environment, once", () => {
  assert.deepEqual(withUpperCasePath({ Path: 'C:\\Git\\cmd', HOME: 'x' }), { PATH: 'C:\\Git\\cmd', HOME: 'x' });
  assert.deepEqual(withUpperCasePath({ PATH: '/usr/bin' }), { PATH: '/usr/bin' });
});

test('the app says this Mac on macOS and this PC on Windows', () => {
  assert.equal(thisComputer('darwin'), 'this Mac');
  assert.equal(thisComputer('win32'), 'this PC');
});
