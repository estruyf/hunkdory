// Which agent sessions worked on which branch. Pure, so it can be tested without git.
import type { SessionInfo } from '../shared/types.ts';

export interface BranchSessions {
  branch: string;
  /** Most recent activity on this branch first. Resume the first one. */
  sessions: SessionInfo[];
  /** The session in which the branch first appeared. Its first prompt is "what you asked for". */
  origin: SessionInfo;
  lastSeen: string;
}

const lastSeenOn = (s: SessionInfo, branch: string) => s.branches.find((b) => b.name === branch)?.lastSeen ?? '';
const firstSeenOn = (s: SessionInfo, branch: string) => s.branches.find((b) => b.name === branch)?.firstSeen ?? '';

/**
 * Group sessions by the branches they ran on.
 * `exists` filters out branches that were deleted since; `exclude` drops base and
 * integration branches (main, dev, and any branch a worktree was created from).
 */
export function matchSessions(
  sessions: SessionInfo[],
  opts: { exists: (branch: string) => boolean; exclude: Set<string> }
): Map<string, BranchSessions> {
  const byBranch = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    for (const { name } of s.branches) {
      if (opts.exclude.has(name) || !opts.exists(name)) continue;
      if (!byBranch.has(name)) byBranch.set(name, []);
      byBranch.get(name)!.push(s);
    }
  }
  const out = new Map<string, BranchSessions>();
  for (const [branch, list] of byBranch) {
    const recent = [...list].sort((a, b) => lastSeenOn(b, branch).localeCompare(lastSeenOn(a, branch)));
    // Not simply the oldest session: an old session can wander onto a branch long after it was made.
    const origin = [...list].sort((a, b) => firstSeenOn(a, branch).localeCompare(firstSeenOn(b, branch)))[0];
    out.set(branch, { branch, sessions: recent, origin, lastSeen: lastSeenOn(recent[0], branch) });
  }
  return out;
}

/** Branches a worktree was created from are integration branches, not agent work. */
export function integrationBranches(sessions: SessionInfo[], base: string): Set<string> {
  const set = new Set<string>([base, base.replace(/^origin\//, ''), 'main', 'master']);
  for (const s of sessions) if (s.originalBranch) set.add(s.originalBranch);
  return set;
}

/** "claude/*, copilot/*" style patterns. `*` stays within one path segment, `**` crosses them. */
export function matchesPattern(branch: string, pattern: string): boolean {
  return pattern
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => {
      const re = p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '.*');
      return new RegExp(`^${re}$`).test(branch);
    });
}

/**
 * Claude Code records the branch a session saw, and sometimes that is just "HEAD"
 * (a repo without commits yet, a detached checkout). Such sessions are attributed to
 * the branch checked out where they ran: the deepest worktree containing their cwd.
 */
export function withCheckoutFallback(
  sessions: SessionInfo[],
  checkouts: { path: string; branch: string | null }[],
  exclude: Set<string>
): SessionInfo[] {
  const byDepth = [...checkouts].sort((a, b) => b.path.length - a.path.length);
  return sessions.map((s) => {
    if (s.branches.length) return s;
    const tree = byDepth.find((t) => s.cwd === t.path || s.cwd.startsWith(`${t.path}/`));
    if (!tree?.branch || exclude.has(tree.branch)) return s;
    return { ...s, branches: [{ name: tree.branch, firstSeen: s.startedAt ?? '', lastSeen: s.endedAt ?? s.startedAt ?? '' }] };
  });
}
