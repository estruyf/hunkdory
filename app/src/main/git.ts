import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shellEnv } from './shellEnv.ts';
import type { BranchInfo, ReviewData } from '../shared/types.ts';

const run = promisify(execFile);

// Your shell's PATH, as in a terminal: hooks a commit or push runs (husky, lint-staged) need node and the like.
export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], { cwd, env: await shellEnv(), maxBuffer: 256 * 1024 * 1024, windowsHide: true });
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

/**
 * The integration branch this branch was cut from: the candidate it has the fewest
 * commits on top of. Ties go to the earlier candidate (session origin, then project base),
 * so a local branch that's up to date keeps its name over its copy on origin.
 */
export async function pickBase(root: string, branch: string, candidates: (string | null | undefined)[]): Promise<{ ref: string; ahead: number }> {
  let best: { ref: string; ahead: number } | null = null;
  for (const ref of new Set(candidates.filter((c): c is string => !!c && c !== branch))) {
    const n = (await tryGit(['rev-list', '--count', `${ref}..${branch}`], root))?.trim();
    if (n === undefined || n === '') continue;
    if (!best || Number(n) < best.ahead) best = { ref, ahead: Number(n) };
  }
  return best ?? { ref: candidates.find(Boolean)!, ahead: 0 };
}

/** A local base you picked that's behind origin: how many of the review's commits are already on its copy there. Hunkdory's own pick never needs this. */
export async function staleBase(root: string, branch: Pick<BranchInfo, 'baseRef' | 'baseChosen' | 'headRef' | 'uncommitted'>): Promise<ReviewData['staleBase']> {
  if (!branch.baseChosen || branch.uncommitted || branch.baseRef.startsWith('origin/')) return null;
  const remote = `origin/${branch.baseRef}`;
  if (!(await refExists(root, remote))) return null;
  const onTop = async (ref: string) => Number((await git(['rev-list', '--count', `${ref}..${branch.headRef}`], root)).trim());
  const commits = (await onTop(branch.baseRef)) - (await onTop(remote));
  return commits > 0 ? { remote, commits } : null;
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

/** Every "checkout: moving from X to Y" entry in HEAD's reflog, oldest first. Used to guess which branch an old Copilot main-folder session ran on. */
export async function reflogCheckouts(root: string): Promise<{ at: string; branch: string }[]> {
  const out = await tryGit(['reflog', 'show', 'HEAD', '--date=iso-strict', '--format=%cd %gs'], root);
  if (!out) return [];
  const list: { at: string; branch: string }[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\S+)\s+checkout: moving from \S+ to (.+)$/);
    if (m) list.push({ at: m[1], branch: m[2] });
  }
  return list.reverse();
}

/** A branch's own first and last commit times, oldest and newest. Null for a branch that doesn't exist. */
export async function commitTimeRange(root: string, branch: string): Promise<{ first: string; last: string } | null> {
  const out = await tryGit(['log', '--format=%cI', branch], root);
  const lines = out?.trim().split('\n').filter(Boolean) ?? [];
  return lines.length ? { first: lines[lines.length - 1], last: lines[0] } : null;
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

/** Why an agent can't edit `branch` from `cwd`: a session's folder may have moved on since, and its edits would land there. Null when it's on it. */
export async function notOnBranch(cwd: string, branch: string): Promise<string | null> {
  const current = await currentBranch(cwd);
  return current === branch ? null : `${cwd} is on "${current ?? 'a detached HEAD'}" now, so an agent working there wouldn't change ${branch}. Switch that folder back to ${branch} first (if git says it's checked out elsewhere, work from that folder instead).`;
}
