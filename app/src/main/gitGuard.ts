// Agents may run read-only git without asking, but that permission only looks at how a command starts: `git grep -O<program>`
// runs a program and `git diff --output=<file>` writes a file, and both Claude Code and Copilot let them through. Code under
// review can ask for exactly that, so an agent's `git` is this wrapper, which sees the arguments after the shell parsed them.
// On Windows the same script guards Git Bash, where Claude Code runs its commands, and a PowerShell twin (git.ps1) guards
// PowerShell, where Copilot runs its commands.
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

const psQuoted = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The same check for PowerShell, on the arguments as PowerShell hands them to git. They are flattened first: `x,-Ox` is
 * one array to a script but two arguments to git.exe. Before PowerShell 7.3, arguments go to a program without escaping
 * their quotes, so `a"b` or a trailing `\` could turn one argument into several; there those are refused. Pure.
 */
export function gitGuardPowerShell(realGit: string): string {
  return `# Hunkdory's git guard for PowerShell (gitGuard.ts in the app).
$flat = [System.Collections.Generic.List[string]]::new()
function Add-Arg($a) {
  if ($a -is [System.Collections.IEnumerable] -and $a -isnot [string]) { foreach ($b in $a) { Add-Arg $b } } else { $flat.Add([string]$a) }
}
foreach ($a in $args) { Add-Arg $a }
function Refuse($what) {
  [Console]::Error.WriteLine("Hunkdory: $what is not allowed: that option can write files or run programs.")
  exit 1
}
$escaped = $PSNativeCommandArgumentPassing -eq 'Windows' -or $PSNativeCommandArgumentPassing -eq 'Standard'
$sub = $null
$skip = $false
foreach ($a in $flat) {
  if (-not $escaped -and ($a.Contains('"') -or $a.EndsWith('\\'))) { Refuse "git with an argument like $a" }
  if ($skip) { $skip = $false; continue }
  if ($null -eq $sub) {
    if ($a -cin '-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env') { $skip = $true }
    elseif (-not $a.StartsWith('-', [StringComparison]::Ordinal)) { $sub = $a }
    continue
  }
  $refused = $false
  if ($sub -cin 'diff', 'show', 'log') { $refused = $a -ceq '--ou' -or $a.StartsWith('--ou=', [StringComparison]::Ordinal) -or $a.StartsWith('--out', [StringComparison]::Ordinal) }
  elseif ($sub -ceq 'grep') { $refused = $a.StartsWith('--op', [StringComparison]::Ordinal) -or $a.StartsWith('-O', [StringComparison]::Ordinal) -or $a -cmatch '^-[^-].*O' }
  if ($refused) { Refuse "git $sub $a" }
}
& ${psQuoted(realGit)} @flat
exit $LASTEXITCODE
`;
}

let folder: string | null = null;
/** Where the wrapper lives. It has to outlast the app: a send-back keeps running after you quit. */
export function useGuardFolder(path: string) {
  folder = path;
}

let written: Promise<string[] | null> | null = null;
/** The folders that go first on an agent's PATH, in order. */
function guardFolders(env: NodeJS.ProcessEnv): Promise<string[] | null> {
  written ??= (async () => {
    const git = await which('git', env);
    if (!git) return null;
    const dir = folder ?? mkdtempSync(join(tmpdir(), 'hunkdory-git-'));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'git');
    // Git Bash reads C:/Program Files/Git/cmd/git.exe, not its backslashes.
    writeFileSync(file, gitGuardScript(gitPath(git)));
    chmodSync(file, 0o755);
    if (process.platform !== 'win32') return [dir];
    // git.ps1 in a folder of its own, ahead of the other: PowerShell finds it there before any git, and Git Bash, which
    // only looks for `git` and `git.exe`, goes on to the sh wrapper.
    const ps = join(dir, 'powershell');
    mkdirSync(ps, { recursive: true });
    writeFileSync(join(ps, 'git.ps1'), gitGuardPowerShell(git));
    return [ps, dir];
  })();
  return written;
}

/**
 * The environment for an agent's run: yours, with the wrapper first on the PATH. On Windows PowerShell may run local
 * scripts, git.ps1 among them, for this process only; a policy set by Group Policy still wins, and then git fails
 * rather than going unguarded.
 */
export async function agentEnv(from: Promise<NodeJS.ProcessEnv> = shellEnv()): Promise<NodeJS.ProcessEnv> {
  const env = await from;
  const dirs = await guardFolders(env);
  if (!dirs) return { ...env };
  return { ...env, PATH: [...dirs, env.PATH ?? ''].join(delimiter), ...(process.platform === 'win32' && { PSExecutionPolicyPreference: 'RemoteSigned' }) };
}
