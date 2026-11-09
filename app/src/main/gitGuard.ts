// Agents may run read-only git without asking, but that permission only looks at how a command starts: `git grep -O<program>`
// runs a program and `git diff --output=<file>` writes a file, and both Claude Code and Copilot let them through. Code under
// review can ask for exactly that, so an agent's `git` is this wrapper, which sees the arguments after the shell parsed them.
// On Windows it guards what runs in Git Bash, where Claude Code runs its commands. PowerShell doesn't run it, which is why
// Copilot, whose commands run there, isn't offered on Windows (assistants/copilot.ts).
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { gitPath } from './paths.ts';
import { shellEnv, which } from './shellEnv.ts';

const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Only the commands agents get without asking, so an agent you allowed more can still `git checkout --ours`.
 * Options git takes before the command (`-c x=y`, `-C dir`) are skipped. `--` doesn't end the check: `-e --` makes it a
 * value, with the option still to come, so the odd path that looks like one of these is refused too. Pure.
 */
export function gitGuardScript(realGit: string): string {
  return `#!/bin/sh
sub=
skip=
for a in "$@"; do
  if [ -n "$skip" ]; then skip=; continue; fi
  if [ -z "$sub" ]; then
    case "$a" in
      -c|-C|--git-dir|--work-tree|--namespace|--config-env) skip=1 ;;
      -*) ;;
      *) sub=$a ;;
    esac
    continue
  fi
  refused=
  case "$sub" in
    diff|show|log) case "$a" in --ou|--ou=*|--out*) refused=1 ;; esac ;;
    grep) case "$a" in --op*|-O*|-[!-]*O*) refused=1 ;; esac ;;
  esac
  if [ -n "$refused" ]; then
    echo "Hunkdory: git $sub $a is not allowed: that option can write files or run programs." >&2
    exit 1
  fi
done
exec ${quoted(realGit)} "$@"
`;
}

let folder: string | null = null;
/** Where the wrapper lives. It has to outlast the app: a send-back keeps running after you quit. */
export function useGuardFolder(path: string) {
  folder = path;
}

let written: Promise<string | null> | null = null;
function guardFolder(env: NodeJS.ProcessEnv): Promise<string | null> {
  written ??= (async () => {
    const git = await which('git', env);
    if (!git) return null;
    const dir = folder ?? mkdtempSync(join(tmpdir(), 'hunkdory-git-'));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'git');
    // Git Bash reads C:/Program Files/Git/cmd/git.exe, not its backslashes.
    writeFileSync(file, gitGuardScript(gitPath(git)));
    chmodSync(file, 0o755);
    return dir;
  })();
  return written;
}

/** The environment for an agent's run: yours, with the wrapper first on the PATH. */
export async function agentEnv(from: Promise<NodeJS.ProcessEnv> = shellEnv()): Promise<NodeJS.ProcessEnv> {
  const env = await from;
  const dir = await guardFolder(env);
  return dir ? { ...env, PATH: `${dir}${delimiter}${env.PATH ?? ''}` } : { ...env };
}
