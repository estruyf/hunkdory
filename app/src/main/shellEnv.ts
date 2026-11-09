// Apps started from Finder get a minimal environment. Borrow the user's login shell's, so `claude`, `gh` and
// `wtv` resolve and sign in the same way they do in a terminal (an API key or GH_TOKEN set in .zshrc, say).
// On Windows an app started from the Start menu already has the user's whole environment, so it is used as it is.
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** A shell that failed or was too slow gets another go after this long: it shouldn't leave tools "not installed" until a restart. */
const RETRY_FAILED_MS = 30_000;
let cached: Promise<NodeJS.ProcessEnv> | null = null;
let failedAt: number | null = null;

const START = '__HUNKDORY_ENV__';
const END = '__HUNKDORY_END__';

/** The variables `env -0` printed between the markers, ignoring whatever a shell's startup files print around them. Pure. */
export function parseShellEnv(stdout: string): NodeJS.ProcessEnv | null {
  const from = stdout.indexOf(START);
  const to = stdout.lastIndexOf(END);
  if (from < 0 || to < from) return null;
  const out: NodeJS.ProcessEnv = {};
  for (const entry of stdout.slice(from + START.length, to).split('\0')) {
    const at = entry.indexOf('=');
    if (at > 0) out[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return out.PATH ? out : null;
}

/**
 * Windows spells it `Path`, and only process.env itself ignores the case: in a copy, `env.PATH` would be missing, and a
 * child given both would see either. So a copy has it once, as PATH. Pure.
 */
export function withUpperCasePath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  const key = Object.keys(out).find((k) => k !== 'PATH' && k.toUpperCase() === 'PATH');
  if (key) {
    out.PATH ??= out[key];
    delete out[key];
  }
  return out;
}

export function shellEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') return (cached ??= Promise.resolve(withUpperCasePath(process.env)));
  if (failedAt !== null && Date.now() - failedAt > RETRY_FAILED_MS) forgetShellEnv();
  cached ??= (async () => {
    const shell = process.env.SHELL || '/bin/zsh';
    try {
      const { stdout } = await run(shell, ['-ilc', `printf '${START}'; /usr/bin/env -0; printf '${END}'`], { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
      const env = parseShellEnv(stdout);
      if (env) return { ...process.env, ...env };
    } catch {}
    failedAt = Date.now();
    return process.env;
  })();
  return cached;
}

/**
 * For agents that may load a repo's own config and MCP servers, which code under review controls: your shell's PATH to
 * find the tools, but not the tokens and keys in your .zshrc.
 */
export async function pathOnlyEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: (await shellEnv()).PATH };
}

/** Reads the shell's environment again: you may just have installed something, or signed in. */
export function forgetShellEnv() {
  cached = null;
  failedAt = null;
}

/**
 * Where a command is on the PATH. On Windows only a program (`.exe`) counts: npm's `.cmd` shims only start through
 * cmd.exe, which would read the quotes and `&` in a prompt as its own.
 */
export async function which(cmd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const name = process.platform === 'win32' ? `${cmd}.exe` : cmd;
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const full = join(dir.replace(/^"(.*)"$/, '$1'), name);
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {}
  }
  return null;
}

/**
 * How an agent runs the walkthrough check on this computer, or null when it can't: `wtv` itself, or the copy inside the
 * app, which needs `node`. The app doesn't: it has the same check built in, and runs it on whatever the agent leaves
 * behind. On Windows the path is written with `/`, which Git Bash, where Claude Code runs commands, reads as it is.
 */
export async function wtvCommand(wtvBin: string, env: NodeJS.ProcessEnv, platform = process.platform): Promise<string | null> {
  if (await which('wtv', env)) return 'wtv';
  if (!(await which('node', env))) return null;
  const bin = platform === 'win32' ? wtvBin.replaceAll('\\', '/') : wtvBin;
  return /\s/.test(bin) ? `node "${bin}"` : `node ${bin}`;
}
