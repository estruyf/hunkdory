// Which agent sessions worked on which branch. Pure, so it can be tested without git.
import type { SessionInfo } from '../shared/types.ts';

export interface BranchSessions {
  branch: string;
  /** Most recent activity on this branch first. Resume the first one. */
  sessions: SessionInfo[];
  /** The session in which the branch first appeared. Its first prompt is "what you asked for". */
  origin: SessionInfo;
  lastSeen: string;
  /** Every session here came from a guess (see `weakMatchMainFolder`), not a worktree or a recorded branch. */
  probable: boolean;
}

const lastSeenOn = (s: SessionInfo, branch: string) => s.branches.find((b) => b.name === branch)?.lastSeen ?? '';
const firstSeenOn = (s: SessionInfo, branch: string) => s.branches.find((b) => b.name === branch)?.firstSeen ?? '';

/**
 * Group sessions by the branches they ran on.
 * `exists` filters out branches that were deleted since; `exclude` drops base and
 * integration branches (main, dev, and any branch a worktree was created from).
 * `probable` marks sessions that were only guessed at (see `weakMatchMainFolder`), not recorded or in a worktree.
 */
export function matchSessions(
  sessions: SessionInfo[],
  opts: { exists: (branch: string) => boolean; exclude: Set<string>; probable?: Set<string> }
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
    out.set(branch, { branch, sessions: recent, origin, lastSeen: lastSeenOn(recent[0], branch), probable: list.every((s) => opts.probable?.has(s.id)) });
  }
  return out;
}

export interface ReflogCheckout {
  /** ISO timestamp of the checkout. */
  at: string;
  /** Branch checked out from that point until the next entry here (or until now, for the last one). */
  branch: string;
}

/** Whether `branch` was the one checked out, by the reflog, at any point overlapping [from, to]. */
function checkedOutDuring(checkouts: ReflogCheckout[], branch: string, from: string, to: string): boolean {
  const sorted = [...checkouts].sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].branch !== branch) continue;
    const start = sorted[i].at;
    const end = sorted[i + 1]?.at ?? '9999-12-31T23:59:59.999Z';
    if (start <= to && end >= from) return true;
  }
  return false;
}

/**
 * Copilot CLI sessions that ran in the repo's main folder (not a worktree) don't say which branch they
 * were on, and the folder moves to another branch once they end: unlike a worktree's path, its cwd alone
 * doesn't say which branch a past session belongs to. Guess one from the reflog: the single branch whose
 * own commits overlap the session's active window, and that the reflog says was checked out there during
 * that window. More than one branch fitting is worse than no guess, so it's left unmatched.
 * Pure, so it can be tested without a real reflog; projects.ts supplies `checkouts` and `commitRanges`.
 */
export function weakMatchMainFolder(
  sessions: SessionInfo[],
  checkouts: ReflogCheckout[],
  commitRanges: Map<string, { first: string; last: string }>
): Map<string, SessionInfo[]> {
  const out = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    if (!s.startedAt) continue;
    const from = s.startedAt;
    const to = s.endedAt ?? s.startedAt;
    const fits: string[] = [];
    for (const [branch, range] of commitRanges) {
      if (to < range.first || from > range.last) continue;
      if (checkedOutDuring(checkouts, branch, from, to)) fits.push(branch);
    }
    if (fits.length === 1) out.set(fits[0], [...(out.get(fits[0]) ?? []), s]);
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

export interface BranchHead {
  name: string;
  headSha: string;
  pr: boolean;
  dirty: boolean;
}

/**
 * Branches that only point at another branch's commit, like a worktree Claude Code made to answer a question
 * about a branch: the same change twice in the inbox. Maps each one to the branch it folds into.
 * A pull request is never folded away, and branches with uncommitted work differ, so they stay.
 */
export function duplicateBranches(heads: BranchHead[]): Map<string, string> {
  const rank = (h: BranchHead) => (h.pr ? 0 : /^worktree-/.test(h.name) ? 2 : 1);
  const bySha = new Map<string, BranchHead[]>();
  for (const h of heads) if (!h.dirty) bySha.set(h.headSha, [...(bySha.get(h.headSha) ?? []), h]);
  const out = new Map<string, string>();
  for (const group of bySha.values()) {
    if (group.length < 2) continue;
    const [keep, ...rest] = [...group].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    for (const h of rest) if (!h.pr) out.set(h.name, keep.name);
  }
  return out;
}

/**
 * A branch that starts from another inbox branch, like review fixes on top of a PR: its diff
 * includes that branch's changes too. `unique` holds each branch's commits that aren't on its base.
 */
export function buildsOn(heads: Pick<BranchHead, 'name' | 'headSha'>[], unique: Map<string, Set<string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of heads) {
    const own = unique.get(h.name);
    const under = own && heads.find((o) => o.name !== h.name && o.headSha !== h.headSha && own.has(o.headSha));
    if (under) out.set(h.name, under.name);
  }
  return out;
}
