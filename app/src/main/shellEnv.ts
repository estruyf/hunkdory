// Apps started from Finder get a minimal environment. Borrow the user's login shell's, so `claude`, `gh` and
// `wtv` resolve and sign in the same way they do in a terminal (an API key or GH_TOKEN set in .zshrc, say).
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
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

export function shellEnv(): Promise<NodeJS.ProcessEnv> {
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

export async function which(cmd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) {
    const full = join(dir, cmd);
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {}
  }
  return null;
}

/**
 * How an agent runs the walkthrough check on this Mac, or null when it can't: `wtv` itself, or the copy inside the app,
 * which needs `node`. The app doesn't: it has the same check built in, and runs it on whatever the agent leaves behind.
 */
export async function wtvCommand(wtvBin: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (await which('wtv', env)) return 'wtv';
  if (!(await which('node', env))) return null;
  return /\s/.test(wtvBin) ? `node "${wtvBin}"` : `node ${wtvBin}`;
}
