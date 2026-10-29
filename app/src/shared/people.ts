// Who's on an inbox item, as one line for its card, and the People filter. Pure.
import type { InboxItem, PrReview } from './types.ts';

export type PeopleRole = 'assigned' | 'requested' | 'opened';

/** "anyone", or a role and a person: `assigned:me`, `opened:alice`. */
export type PeopleFilter = 'anyone' | `${PeopleRole}:${string}`;

type Item = Pick<InboxItem, 'pr' | 'openedBy' | 'openedByYou'>;

const STATE: Record<PrReview['state'], string> = { APPROVED: '✓ approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'commented' };

// Review bots comment on every PR; on a card they drown out the people.
const isBot = (login: string) => /\[bot\]$|^copilot|^app\//i.test(login);

/**
 * "Opened by alice · Review: bob ✓ approved, carol (requested) · Assigned: dave". Empty parts are left
 * out, and `me` (your gh login) reads "you". A local branch only has who opened it.
 */
export function peopleLine(w: Item, me: string | null): string {
  const name = (login: string) => (me && login === me ? 'you' : login);
  const parts: string[] = [];
  if (w.openedBy) parts.push(`Opened by ${w.openedByYou ? 'you' : name(w.openedBy)}`);
  if (w.pr) {
    // Asked again after reviewing: the request is the news.
    const reviewed = w.pr.reviews.filter((r) => !isBot(r.login) && !w.pr!.requestedReviewers.includes(r.login)).map((r) => `${name(r.login)} ${STATE[r.state]}`);
    const requested = w.pr.requestedReviewers.filter((l) => !isBot(l)).map((l) => `${name(l)} (requested)`);
    if (reviewed.length || requested.length) parts.push(`Review: ${[...reviewed, ...requested].join(', ')}`);
    if (w.pr.assignees.length) parts.push(`Assigned: ${w.pr.assignees.map(name).join(', ')}`);
  }
  return parts.join(' · ');
}

/** Does the item match the filter? Assignees and review requests only exist on PRs. */
export function matchesPeople(w: Item, filter: PeopleFilter, me: string | null): boolean {
  if (filter === 'anyone') return true;
  const [role, ...rest] = filter.split(':') as [PeopleRole, ...string[]];
  const who = rest.join(':');
  if (role === 'opened') return who === 'me' ? w.openedByYou : w.openedBy === who && !w.openedByYou;
  const list = role === 'assigned' ? w.pr?.assignees : w.pr?.requestedReviewers;
  if (!list) return false;
  return list.includes(who === 'me' ? (me ?? '') : who);
}

/** The people found on the items, per role, without you: the filter lists "Me" first on its own. */
export function peopleOptions(items: Item[], me: string | null): Record<PeopleRole, string[]> {
  const sets = { assigned: new Set<string>(), requested: new Set<string>(), opened: new Set<string>() };
  for (const w of items) {
    for (const a of w.pr?.assignees ?? []) sets.assigned.add(a);
    for (const r of w.pr?.requestedReviewers ?? []) sets.requested.add(r);
    if (w.openedBy && !w.openedByYou) sets.opened.add(w.openedBy);
  }
  const list = (s: Set<string>) => [...s].filter((x) => x !== me).sort((a, b) => a.localeCompare(b));
  return { assigned: list(sets.assigned), requested: list(sets.requested), opened: list(sets.opened) };
}

/** Why local branches are missing while the filter is on, or null when they aren't. */
export function hidesLocal(filter: PeopleFilter): string | null {
  if (filter.startsWith('assigned:')) return 'Local branches have no assignees, so they are hidden while this filter is on.';
  if (filter.startsWith('requested:')) return 'Local branches have no review requests, so they are hidden while this filter is on.';
  return null;
}
