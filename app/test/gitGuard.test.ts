import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { agentEnv, gitGuardScript } from '../src/main/gitGuard.ts';
import { gitPath } from '../src/main/paths.ts';
import { forgetShellEnv, parseShellEnv, pathOnlyEnv, shellEnv, which, withUpperCasePath, wtvCommand } from '../src/main/shellEnv.ts';

const win = process.platform === 'win32';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hunkdory-guard-')));
after(() => rmSync(root, { recursive: true, force: true }));

// On Windows the wrapper runs in Git Bash, where Claude Code runs its commands: Git's own sh.
const winEnv = withUpperCasePath(process.env);
const realGit = win ? (await which('git', winEnv))! : execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const sh = win ? ((await which('sh', winEnv)) ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'sh.exe')) : '/bin/sh';
const guard = join(root, 'git');
writeFileSync(guard, gitGuardScript(gitPath(realGit)));
chmodSync(guard, 0o755);

const repo = join(root, 'repo');
const plain = (...args: string[]) => execFileSync(realGit, ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@t.invalid', ...args], { cwd: repo, encoding: 'utf8' });
mkdirSync(repo);
plain('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'a.js'), 'const Offset = 1;\n');
plain('add', '.');
plain('commit', '-q', '-m', 'one');
writeFileSync(join(repo, 'a.js'), 'const Offset = 2;\n');
plain('add', '.');
plain('commit', '-q', '-m', 'two');

const run = (...args: string[]) => (win ? spawnSync(sh, [guard, ...args], { cwd: repo, encoding: 'utf8' }) : spawnSync(guard, args, { cwd: repo, encoding: 'utf8' }));

test('git options that write files or run programs are refused, however they are written', () => {
  const made = join(root, 'made');
  for (const args of [
    ['diff', `--output=${made}`, 'HEAD~1'],
    ['diff', '--outp', made, 'HEAD~1'],
    ['show', `--output=${made}`],
    ['log', `--ou=${made}`],
    ['grep', `-Otouch ${made}`, 'Offset'],
    ['grep', `-iOtouch ${made}`, 'Offset'],
    ['grep', '-n', `-Otouch ${made}`, 'Offset'],
    ['grep', `--open-files-in-pager=touch ${made}`, 'Offset'],
    ['grep', `--op=touch ${made}`, 'Offset'],
    ['-c', 'a.b=c', 'diff', `--output=${made}`, 'HEAD~1'],
    ['-C', repo, 'grep', `-Otouch ${made}`, 'Offset'],
    ['--no-pager', 'diff', `--output=${made}`, 'HEAD~1'],
    ['grep', '-e', '--', `-Otouch ${made}`, 'Offset'],
    ['grep', '-e', '--', `--open-files-in-pager=touch ${made}`],
    ['diff', '--no-index', '-S', '--', `--output=${made}`, 'a.js', 'a.js'],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /not allowed: that option can write files or run programs/);
  }
  assert.equal(existsSync(made), false);
});

test('everyday git goes through untouched', () => {
  assert.match(run('log', '--oneline').stdout, /one/);
  assert.match(run('log', '--format=%s', '-1').stdout, /two/);
  assert.match(run('diff', 'HEAD~1').stdout, /Offset = 2/);
  assert.match(run('grep', '-n', 'Offset').stdout, /a\.js:1/, 'a capital O in what you search for is fine');
  assert.match(run('grep', '-e', 'Offset').stdout, /a\.js/);
  assert.match(run('-c', 'core.quotePath=false', 'log', '-1', '--format=%s').stdout, /two/);
  assert.equal(run('status', '--porcelain').status, 0);
  assert.equal(run('log', '--', 'a.js').status, 0);
  assert.equal(run('diff', '--ours').status, 0, '--ours starts like --output, and only reads');
  assert.equal(run('--version').status, 0, 'no command at all');
});

test('commands an agent has to be allowed anyway keep their options', () => {
  // Only the read-only commands are limited: `checkout --ours` starts the same way as `--output`.
  plain('checkout', '-q', '-b', 'other', 'HEAD~1');
  writeFileSync(join(repo, 'a.js'), 'const Offset = 3;\n');
  plain('commit', '-qam', 'three');
  assert.equal(spawnSync(realGit, ['merge', 'main'], { cwd: repo, encoding: 'utf8' }).status, 1, 'a conflict to resolve');
  const r = run('checkout', '--ours', 'a.js');
  assert.equal(r.status, 0, r.stderr);
  plain('merge', '--abort');
  plain('checkout', '-q', 'main');
});

test('an agent finds the wrapper first, and Hunkdory\'s own git does not', async () => {
  const env = await agentEnv();
  const first = (await shellEnv()).PATH?.split(delimiter)[0] ?? '';
  assert.ok(env.PATH!.includes(`${delimiter}${first}`), 'your PATH follows the wrapper');
  if (win) {
    // Git Bash finds the wrapper; Hunkdory itself only starts git.exe, so it gets the real one.
    const found = execFileSync(sh, ['-c', 'command -v git'], { env, encoding: 'utf8' }).trim();
    assert.equal(found.split('/').pop(), 'git');
    assert.match(execFileSync(sh, ['-c', 'git --version'], { env, encoding: 'utf8' }), /git version/);
    assert.equal(await which('git', env), realGit);
    return;
  }
  const git = await which('git', env);
  assert.notEqual(git, realGit);
  assert.match(execFileSync(git!, ['--version'], { encoding: 'utf8' }), /git version/);
});

test('an agent that may load a repo\'s own config gets your PATH, not your shell\'s tokens', { skip: win && 'Windows reads no login shell: the app has your environment already' }, async () => {
  const shell = realpathSync(mkdtempSync(join(root, 'shell-')));
  const fake = join(shell, 'zsh');
  writeFileSync(fake, `#!/bin/sh\nprintf '__HUNKDORY_ENV__PATH=/from/shell:/usr/bin:/bin\\0GH_TOKEN=secret\\0__HUNKDORY_END__'\n`);
  chmodSync(fake, 0o755);
  const before = { SHELL: process.env.SHELL, GH_TOKEN: process.env.GH_TOKEN };
  process.env.SHELL = fake;
  delete process.env.GH_TOKEN;
  forgetShellEnv();
  try {
    assert.equal((await shellEnv()).GH_TOKEN, 'secret', 'your own runs get it');
    const env = await pathOnlyEnv();
    assert.match(env.PATH!, /^\/from\/shell:/);
    assert.equal(env.GH_TOKEN, undefined);
  } finally {
    process.env.SHELL = before.SHELL;
    if (before.GH_TOKEN !== undefined) process.env.GH_TOKEN = before.GH_TOKEN;
    forgetShellEnv();
  }
});

test('the walkthrough check is only offered when it can run', async () => {
  const dir = join(root, 'tools');
  mkdirSync(dir);
  const tool = (name: string) => {
    const file = join(dir, win ? `${name}.exe` : name);
    writeFileSync(file, '#!/bin/sh\n');
    chmodSync(file, 0o755);
  };
  const env = { PATH: dir };
  assert.equal(await wtvCommand('/Applications/Hunkdory.app/wtv.mjs', env), null, 'neither wtv nor node: the app checks it itself');
  tool('node');
  assert.equal(await wtvCommand('/Applications/Hunkdory.app/wtv.mjs', env), 'node /Applications/Hunkdory.app/wtv.mjs');
  assert.equal(await wtvCommand('/Users/me/My Apps/wtv.mjs', env), 'node "/Users/me/My Apps/wtv.mjs"', 'a space in the path');
  tool('wtv');
  assert.equal(await wtvCommand('/Applications/Hunkdory.app/wtv.mjs', env), 'wtv');
});

test('the shell environment is what env printed, whatever the startup files say around it', () => {
  const out = 'Welcome to my shell!\n__HUNKDORY_ENV__PATH=/a:/b\0GH_TOKEN=abc=def\0MULTI=one\ntwo\0__HUNKDORY_END__bye\n';
  assert.deepEqual(parseShellEnv(out), { PATH: '/a:/b', GH_TOKEN: 'abc=def', MULTI: 'one\ntwo' });
  assert.equal(parseShellEnv('no markers'), null);
  assert.equal(parseShellEnv('__HUNKDORY_ENV__A=1\0__HUNKDORY_END__'), null, 'no PATH is not a real answer');
});
