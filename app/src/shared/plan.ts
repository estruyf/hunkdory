// The review plan: what only you can decide, what to look at carefully, and what to skim. Pure.
import type { AttentionFlag, CheckItem, ReviewData, ReviewState, Step } from './types.ts';
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

export function buildDecisions(steps: Step[], flags: AttentionFlag[], checks: CheckItem[], hasRequest: boolean): PlanDecision[] {
  const out: PlanDecision[] = [];
  const byStory = [...steps].sort((a, b) => a.index - b.index);

  const outside = byStory.filter((s) => s.outsideTask);
  if (outside.length) {
    const files = [...new Set(outside.flatMap((s) => s.files))];
    out.push({
      id: 'outside',
      kind: 'outside',
      severity: 'medium',
      title: `${plural(outside.length, 'step')} ${outside.length === 1 ? 'changes' : 'change'} ${plural(files.length, 'file')} ${hasRequest ? 'you didn’t ask about' : 'outside the stated goal'}`,
      detail: 'Keep them in this change, or have them dropped when you finish.',
      stepKeys: outside.map((s) => s.key),
      files,
      places: outside.map((s) => `Step ${s.index + 1}: ${s.title}`),
    });
  }

  const failing = checks.filter((c) => c.state === 'fail');
  if (failing.length) {
    out.push({
      id: 'ci',
      kind: 'ci',
      severity: 'high',
      title: 'CI is failing on GitHub',
      detail: `${plural(failing.length, 'check')} failed: ${failing.slice(0, 3).map((c) => c.name).join(', ')}${failing.length > 3 ? ` and ${failing.length - 3} more` : ''}.`,
      stepKeys: [],
      files: [],
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
      files: [],
      places: fs.map((f) => f.detail),
    });
  }

  const rank = (d: PlanDecision) => (d.severity === 'high' ? 0 : d.kind === 'outside' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
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

export function buildPlan(data: Pick<ReviewData, 'steps' | 'attention' | 'pr' | 'prompt'>, state: Pick<ReviewState, 'order'>): Plan {
  const careful = orderSteps(data.steps.filter(isCareful), state.order);
  const skim = orderSteps(data.steps.filter((s) => !isCareful(s)), state.order);
  const groups = skimGroups(skim);
  return {
    decisions: buildDecisions(data.steps, data.attention, data.pr?.checks ?? [], !!(data.prompt || data.pr?.body.trim())),
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

/** Steps to drop when you finish: those outside the task, unless you decided to keep them. */
export function defaultDrops(steps: Step[], settled: ReviewState['settled']): string[] {
  if (settled?.outside === 'fine') return [];
  return steps.filter((s) => s.outsideTask).map((s) => s.key);
}
