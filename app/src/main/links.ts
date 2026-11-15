// Links between Hunkdory and other apps. Any app or website can open a hunkdory:// link, so one only ever opens a
// screen: never an assistant, a walkthrough, a merge or a push. Pure, so it can be tested without Electron;
// index.ts receives the links and Projects finds what they point at.
import { posix } from 'node:path';

export const SCHEME = 'hunkdory';

/** `hunkdory://review?repo=<absolute path>&branch=<branch name>`: that branch's review. */
export interface ReviewLink {
  kind: 'review';
  repo: string;
  branch: string;
}

export type Parsed = { ok: true; link: ReviewLink } | { ok: false; reason: string };

const refused = (reason: string): Parsed => ({ ok: false, reason });

/**
 * What a link asks for, or why Hunkdory doesn't go along. Only what the link itself says: whether the folder
 * is there and git takes the branch name is for `checkLink`.
 */
export function parseLink(url: string, platform = process.platform): Parsed {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return refused("It isn't a link.");
  }
  if (u.protocol !== `${SCHEME}:`) return refused(`It isn't a ${SCHEME}:// link.`);
  // The screen is the link's host: hunkdory://review?…
  if (u.hostname !== 'review' || (u.pathname !== '' && u.pathname !== '/')) return refused("Hunkdory doesn't know that link.");
  const one = (name: string) => {
    const all = u.searchParams.getAll(name);
    return all.length === 1 ? all[0]!.trim() : null;
  };
  const repo = one('repo');
  const branch = one('branch');
  if (!repo) return refused('The link needs one repo, the folder of a project.');
  if (!branch) return refused('The link needs one branch.');
  if (!isAbsoluteFolder(repo, platform)) return refused(`The repo has to be a full path, not ${repo}.`);
  // `@` and `@{-1}` stand for where you are or were, not for a branch; a leading dash would read as an option.
  if (branch === '@' || branch.startsWith('-') || branch.includes('@{')) return refused(`${branch} isn't a branch name.`);
  return { ok: true, link: { kind: 'review', repo, branch } };
}

/**
 * A path from the root down. On Windows only one with a drive letter: a network path (\\server\share) would have
 * Windows sign in to that server as you the moment Hunkdory looks for the folder.
 */
export function isAbsoluteFolder(path: string, platform = process.platform): boolean {
  if (platform === 'win32') return /^[a-zA-Z]:[\\/]/.test(path);
  return posix.isAbsolute(path);
}

/** Whether the folder is there and git takes the branch name (`git check-ref-format --branch`). Null when both are. */
export async function checkLink(link: ReviewLink, check: { isFolder(path: string): boolean; branchName(name: string): Promise<boolean> }): Promise<string | null> {
  if (!check.isFolder(link.repo)) return `There's no folder at ${link.repo}.`;
  if (!(await check.branchName(link.branch))) return `${link.branch} isn't a branch name.`;
  return null;
}

/** The link Windows starts Hunkdory with, or hands the running one: it's one of the arguments. */
export function linkInArgv(argv: readonly string[]): string | null {
  return argv.find((a) => a.toLowerCase().startsWith(`${SCHEME}://`)) ?? null;
}

/**
 * The project a folder belongs to: the one whose folder or worktree it is, or is inside, as the inbox matches a
 * session's folder. Both sides are `pathKey`s. With projects inside each other, the closest one.
 */
export function projectFor(folder: string, projects: readonly { id: string; folders: readonly string[] }[], platform = process.platform): string | null {
  // Windows folders don't care about case, and a drive letter can come either way.
  const norm = (p: string) => (platform === 'win32' ? p.replaceAll('/', '\\').toLowerCase() : p).replace(/[/\\]+$/, '');
  const sep = platform === 'win32' ? '\\' : '/';
  const at = norm(folder);
  let best: { id: string; length: number } | null = null;
  for (const p of projects) {
    for (const f of p.folders.map(norm)) {
      if ((at === f || at.startsWith(`${f}${sep}`)) && (!best || f.length > best.length)) best = { id: p.id, length: f.length };
    }
  }
  return best?.id ?? null;
}

/** `seshboard://session/<id>`: Seshboard shows that session, as if you picked it in its sidebar. */
export const seshboardLink = (sessionId: string) => `seshboard://session/${sessionId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one link to another app Hunkdory opens: a Claude Code session in Seshboard, whose ids are UUIDs. */
export function isSeshboardLink(url: string): boolean {
  const m = /^seshboard:\/\/session\/([^/?#]+)$/.exec(url);
  return !!m && UUID.test(m[1]!);
}
