import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

export async function tryGit(args: string[], cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}

export async function repoRoot(path: string): Promise<string | null> {
  return (await tryGit(['rev-parse', '--show-toplevel'], path))?.trim() || null;
}

/** origin/HEAD first, then the usual names. Returned as a ref that exists. */
export async function detectBaseBranch(root: string): Promise<string | null> {
  const head = (await tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root))?.trim();
  if (head) {
    const local = head.replace(/^origin\//, '');
    return (await refExists(root, local)) ? local : head;
  }
  for (const c of ['main', 'master', 'origin/main', 'origin/master', 'develop', 'dev']) {
    if (await refExists(root, c)) return c;
  }
  return null;
}

export async function refExists(root: string, ref: string): Promise<boolean> {
  return (await tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root)) !== null;
}

export async function remoteUrl(root: string): Promise<string | null> {
  const url = (await tryGit(['remote', 'get-url', 'origin'], root))?.trim();
  if (!url) return null;
  return url.replace(/^git@([^:]+):/, '$1/').replace(/^https?:\/\//, '').replace(/\.git$/, '');
}

export async function localBranches(root: string): Promise<string[]> {
  const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], root);
  return out.split('\n').filter(Boolean);
}

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
}

export async function worktrees(root: string): Promise<Worktree[]> {
  const out = await git(['worktree', 'list', '--porcelain'], root);
  const list: Worktree[] = [];
  for (const block of out.split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path) continue;
    if (/^prunable/m.test(block)) continue;
    list.push({
      path,
      head: block.match(/^HEAD (\w+)$/m)?.[1] ?? '',
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
    });
  }
  return list;
}

/** Files with uncommitted changes, ignoring the review folder. */
export async function dirtyFiles(cwd: string): Promise<string[]> {
  const out = await git(['status', '--porcelain', '-z', '--untracked-files=all', '--', '.', ':(exclude).review'], cwd);
  const parts = out.split('\0');
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    files.push(parts[i].slice(3));
    if (/^[RC]/.test(parts[i])) i++; // The original path of a rename or copy follows as its own entry.
  }
  return files;
}

export async function currentBranch(cwd: string): Promise<string | null> {
  return (await tryGit(['symbolic-ref', '--short', 'HEAD'], cwd))?.trim() || null;
}
