// Apps started from Finder get a minimal PATH. Borrow the user's login shell environment
// so `claude`, `node` and `wtv` resolve the same way they do in a terminal.
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
let cached: Promise<NodeJS.ProcessEnv> | null = null;

export function shellEnv(): Promise<NodeJS.ProcessEnv> {
  cached ??= (async () => {
    const shell = process.env.SHELL || '/bin/zsh';
    try {
      const { stdout } = await run(shell, ['-ilc', 'printf "__PATH__%s__END__" "$PATH"'], { timeout: 5000 });
      const path = stdout.match(/__PATH__(.*)__END__/)?.[1];
      if (path) return { ...process.env, PATH: path };
    } catch {}
    return process.env;
  })();
  return cached;
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
