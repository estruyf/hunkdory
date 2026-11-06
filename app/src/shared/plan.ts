// The review plan: what only you can decide, what to look at carefully, and what to skim. Pure.
import type { AttentionFlag, CheckItem, Decision, GitHubEvent, ReviewData, ReviewState, Step } from './types.ts';
import { isReviewed, orderSteps } from './order.ts';

export type Phase = 'careful' | 'skim';

export interface PlanDecision {
  /** Stable id, kept in ReviewState.settled. */
  id: string;
  kind: 'outside' | 'ci' | 'flag';
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  stepKeys: string[];
  files: string[];
  /** Every step it's about, by index. A flag can name more steps than the ones you start at. */
  stepIndexes: number[];
  /** A sentence that doesn't repeat the files and steps. */
  note: string | null;
  /** The flags this decision groups, for showing every place. */
  places: string[];
}

export interface SkimGroup {
  name: string;
  steps: Step[];
  files: number;
}

export interface Plan {
  decisions: PlanDecision[];
  /** Medium flags on steps you read anyway: shown on the step, not asked as a decision. */
  notes: PlanDecision[];
  careful: Step[];
  skim: Step[];
  skimGroups: SkimGroup[];
  /** Every step in walkthrough order: careful ones first, then the ones to skim. */
  sequence: Step[];
}

const OUTSIDE_TITLE = 'Change outside your request';

/** Risky, or not part of what you asked for. Skipped hunks (lockfiles, build output) are always a skim. */
export const isCareful = (s: Step) => s.source !== 'skipped' && (s.risk !== 'low' || s.outsideTask);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const inWords = (items: (string | number)[], shown: number) => {
  const named = items.length > shown ? items.slice(0, shown) : items.slice(0, -1);
  const rest = items.length > shown ? `${items.length - shown} more` : String(items.at(-1));
  return named.length ? `${named.join(', ')} and ${rest}` : rest;
};

/** "my-rules.test.ts, version.test.ts and 3 more": a file's name is what you recognise. */
export const fileNames = (paths: string[], shown = 2) => inWords(paths.map((p) => p.split('/').pop() ?? p), shown);

/** "Step 3", or "Steps 63 and 66" for 0-based indexes. */
export const stepsLabel = (indexes: number[], shown = 4) => `${indexes.length === 1 ? 'Step' : 'Steps'} ${inWords(indexes.map((i) => i + 1), shown)}`;

export function buildDecisions(steps: Step[], flags: AttentionFlag[], checks: CheckItem[], hasRequest: boolean): PlanDecision[] {
  const out: PlanDecision[] = [];
  const byStory = [...steps].sort((a, b) => a.index - b.index);

  const outside = byStory.filter((s) => s.outsideTask);
  if (outside.length) {
    const files = [...new Set(outside.flatMap((s) => s.files))];
    const detail = 'Keep them in this change, or have them dropped when you finish.';
    out.push({
      id: 'outside',
      kind: 'outside',
      severity: 'medium',
      title: `${plural(outside.length, 'step')} ${outside.length === 1 ? 'changes' : 'change'} ${plural(files.length, 'file')} ${hasRequest ? 'you didn’t ask about' : 'outside the stated goal'}`,
      detail,
      stepKeys: outside.map((s) => s.key),
      files,
      stepIndexes: outside.map((s) => s.index),
      note: detail,
      places: outside.map((s) => `Step ${s.index + 1}: ${s.title}`),
    });
  }

  const failing = checks.filter((c) => c.state === 'fail');
  if (failing.length) {
    const detail = `${plural(failing.length, 'check')} failed: ${failing.slice(0, 3).map((c) => c.name).join(', ')}${failing.length > 3 ? ` and ${failing.length - 3} more` : ''}.`;
    out.push({
      id: 'ci',
      kind: 'ci',
      severity: 'high',
      title: 'CI is failing on GitHub',
      detail,
      stepKeys: [],
      files: [],
      stepIndexes: [],
      note: detail,
      places: failing.map((c) => c.name),
    });
  }

  // One decision per kind of flag, however many places it shows up.
  const groups = new Map<string, AttentionFlag[]>();
  for (const f of flags) {
    if (f.title === OUTSIDE_TITLE) continue;
    groups.set(f.title, [...(groups.get(f.title) ?? []), f]);
  }
  for (const [title, fs] of groups) {
    const stepKeys = [...new Set(fs.map((f) => f.stepKey).filter((k): k is string => !!k))];
    out.push({
      id: `flag:${slug(title)}`,
      kind: 'flag',
      severity: fs.some((f) => f.severity === 'high') ? 'high' : 'medium',
      title: fs.length > 1 ? `${title} (${fs.length} places)` : title,
      detail: fs[0].detail,
      stepKeys,
      files: [...new Set(fs.flatMap((f) => f.where?.files ?? []))],
      stepIndexes: [...new Set(fs.flatMap((f) => f.where?.steps ?? []))].sort((a, b) => a - b),
      note: fs[0].where ? fs[0].where.reason : fs[0].detail,
      places: fs.map((f) => f.detail),
    });
  }

  const rank = (d: PlanDecision) => (d.severity === 'high' ? 0 : d.kind === 'outside' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * The decisions as lines for a comment on the PR, for people who aren't in the app. Failing CI stays out: GitHub
 * shows it, and a comment would go stale.
 */
export function decisionsForComment(decisions: PlanDecision[]): string[] {
  return decisions.flatMap((d) => {
    if (d.kind === 'ci') return [];
    return d.kind === 'outside' ? [`**Outside the request.** ${d.places.join('; ')}.`] : [`**${d.title}.** ${d.detail}`];
  });
}

/** Button and result text for a decision. */
export function decisionLabels(d: Pick<PlanDecision, 'kind'>) {
  return d.kind === 'outside'
    ? { fine: 'Keep them', fix: 'Drop them', fineDone: 'Keeping them', fixDone: 'Dropping them when you finish' }
    : { fine: 'It’s fine', fix: 'Needs a fix', fineDone: 'You said it’s fine', fixDone: d.kind === 'flag' ? 'Added to your comments' : 'Needs a fix' };
}

/**
 * A flag that needs a fix becomes a comment on the step you decided it on.
 * Sent with every settle of a flag, so the main process can also take the line out when you change your mind.
 */
export function settleComment(d: Pick<PlanDecision, 'kind' | 'title' | 'detail'>, stepKey: string | undefined) {
  return d.kind === 'flag' ? { stepKey, body: `Needs a fix: ${d.title}. ${d.detail}` } : undefined;
}

/** Where a step lives, in two folder names: "events/registrations". */
export function areaOf(step: Step): string {
  const dirs = (step.files[0] ?? '').split('/').slice(0, -1);
  return dirs.length ? dirs.slice(-2).join('/') : 'Project root';
}

/** Skim steps grouped by where they are. At most six groups; the smallest share an "Other" group. */
export function skimGroups(skim: Step[], max = 6): SkimGroup[] {
  const map = new Map<string, Step[]>();
  for (const s of [...skim].sort((a, b) => a.index - b.index)) map.set(areaOf(s), [...(map.get(areaOf(s)) ?? []), s]);
  let groups = [...map].map(([name, steps]) => ({ name, steps }));
  if (groups.length > max) {
    const bySize = [...groups].sort((a, b) => b.steps.length - a.steps.length);
    const keep = new Set(bySize.slice(0, max - 1).map((g) => g.name));
    const other = groups.filter((g) => !keep.has(g.name)).flatMap((g) => g.steps).sort((a, b) => a.index - b.index);
    groups = [...groups.filter((g) => keep.has(g.name)), { name: 'Other', steps: other }];
  }
  return groups.map((g) => ({ ...g, files: new Set(g.steps.flatMap((s) => s.files)).size }));
}

export function buildPlan(data: Pick<ReviewData, 'steps' | 'attention' | 'pr' | 'prompt'>, state: Pick<ReviewState, 'order' | 'aiReview'>): Plan {
  // A serious AI finding you haven't dismissed: telling you to skim that code would contradict it.
  const flagged = new Set(state.aiReview?.result?.findings.filter((f) => !f.dismissed && f.severity !== 'low').map((f) => f.hunkId));
  const close = (s: Step) => isCareful(s) || (s.source !== 'skipped' && s.hunkIds.some((id) => flagged.has(id)));
  const careful = orderSteps(data.steps.filter(close), state.order);
  const skim = orderSteps(data.steps.filter((s) => !close(s)), state.order);
  const groups = skimGroups(skim);
  const all = buildDecisions(data.steps, data.attention, data.pr?.checks ?? [], !!(data.prompt || data.pr?.body.trim()));
  const isNote = (d: PlanDecision) => d.kind === 'flag' && d.severity === 'medium' && d.stepKeys.length > 0;
  return {
    decisions: all.filter((d) => !isNote(d)),
    notes: all.filter(isNote),
    careful,
    skim,
    skimGroups: groups,
    // Skim in group order, so steps from one place follow each other.
    sequence: [...careful, ...groups.flatMap((g) => g.steps)],
  };
}

export interface PlanProgress {
  decided: number;
  decisions: number;
  careful: number;
  carefulDone: number;
  skim: number;
  skimDone: number;
}

export function planProgress(plan: Plan, state: Pick<ReviewState, 'reviewed' | 'settled'>): PlanProgress {
  const done = (steps: Step[]) => steps.filter((s) => isReviewed(s, state.reviewed)).length;
  return {
    decided: plan.decisions.filter((d) => state.settled?.[d.id]).length,
    decisions: plan.decisions.length,
    careful: plan.careful.length,
    carefulDone: done(plan.careful),
    skim: plan.skim.length,
    skimDone: done(plan.skim),
  };
}

/**
 * Where to pick up a review: the first thing not done yet, in the order the review goes.
 * Decisions come first, so one you put off isn't forgotten once you're reading steps.
 * Null when everything is decided and reviewed.
 */
export function resumePoint(plan: Plan, state: Pick<ReviewState, 'reviewed' | 'settled'>): { decision: PlanDecision; stepKey: string | undefined } | { decision: null; stepKey: string } | null {
  const decision = plan.decisions.find((d) => !state.settled?.[d.id]);
  if (decision) return { decision, stepKey: decision.stepKeys[0] };
  const step = plan.sequence.find((s) => !isReviewed(s, state.reviewed));
  return step ? { decision: null, stepKey: step.key } : null;
}

/** Steps to drop when you finish: those outside the task, only when you decided to drop them. */
export function defaultDrops(steps: Step[], settled: ReviewState['settled']): string[] {
  if (settled?.outside !== 'fix') return [];
  return steps.filter((s) => s.outsideTask).map((s) => s.key);
}

export interface OpenItems {
  /** Decisions you haven't made yet. */
  decisions: PlanDecision[];
  /** Steps to read closely that you haven't marked reviewed. */
  careful: Step[];
  /** Steps to skim that you haven't marked reviewed. */
  skim: Step[];
  /** Flags you said need a fix. */
  fixes: PlanDecision[];
}

/** What's still open or asks for a change, for warning before a merge. */
export function openItems(plan: Plan, state: Pick<ReviewState, 'reviewed' | 'settled'>): OpenItems {
  return {
    decisions: plan.decisions.filter((d) => !state.settled?.[d.id]),
    careful: plan.careful.filter((s) => !isReviewed(s, state.reviewed)),
    skim: plan.skim.filter((s) => !isReviewed(s, state.reviewed)),
    fixes: plan.decisions.filter((d) => d.kind !== 'outside' && state.settled?.[d.id] === 'fix'),
  };
}

/** The steps as the walkthrough tells them, whatever the review's order: reading them top to bottom is reading the story. */
export const storySteps = (data: Pick<ReviewData, 'steps'>) => orderSteps(data.steps, 'story');

/** Where the story picks up: the first step not reviewed yet, and how far in that is. Null when you've read it all. */
export function storyResume(data: Pick<ReviewData, 'steps'>, state: Pick<ReviewState, 'reviewed'>): { step: Step; at: number; of: number; started: boolean } | null {
  const steps = storySteps(data);
  const at = steps.findIndex((s) => !isReviewed(s, state.reviewed));
  return at < 0 ? null : { step: steps[at]!, at: at + 1, of: steps.length, started: steps.some((s) => isReviewed(s, state.reviewed)) };
}

/** Where a review on GitHub starts: asking for the fixes you named, and approving only once nothing is left open. */
export function defaultReviewEvent(open: OpenItems, opts: { comments: number; prByYou: boolean }): GitHubEvent {
  if (open.fixes.length) return 'REQUEST_CHANGES';
  return opts.comments || opts.prByYou || open.decisions.length || open.careful.length || open.skim.length ? 'COMMENT' : 'APPROVE';
}

/** The choices that say the code is good: with something still open, they take a second click. */
export const vouchesForCode = (pick: Decision, event: GitHubEvent) => pick === 'merge' || (pick === 'github' && event === 'APPROVE');

/** Why a pull request can't be merged yet: GitHub only merges what's on the PR, so work on this Mac would be left behind. */
export function unpushedWork(data: Pick<ReviewData, 'pr' | 'dirtyFiles' | 'ahead'>): string | null {
  if (!data.pr || (!data.dirtyFiles && !data.ahead)) return null;
  const parts = [data.dirtyFiles && `${data.dirtyFiles} uncommitted file${data.dirtyFiles === 1 ? '' : 's'}`, data.ahead && `${data.ahead} unpushed commit${data.ahead === 1 ? '' : 's'}`].filter(Boolean);
  const one = data.dirtyFiles + data.ahead === 1;
  return `${parts.join(' and ')} on this Mac ${one ? "isn't" : "aren't"} on PR #${data.pr.number}, so GitHub wouldn't merge ${one ? 'it' : 'them'}. Push ${one ? 'it' : 'them'} from the plan, or undo ${one ? 'it' : 'them'}, first.`;
}
