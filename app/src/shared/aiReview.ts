// The AI review's settings, and what its findings mean for the review on screen. Pure.
import type { AiFinding, AiReviewResult, AiReviewSettings, Comment, ReviewArea, ReviewData, ReviewState, Step } from './types.ts';

export const REVIEW_AREAS: { id: ReviewArea; label: string; detail: string; ask: string }[] = [
  { id: 'bugs', label: 'Bugs', detail: 'Logic that fails: wrong results, crashes, race conditions and missed edge cases.', ask: 'Logic that fails: wrong results, crashes, race conditions, missed edge cases.' },
  {
    id: 'accessibility',
    label: 'Accessibility',
    detail: 'Labels, roles and keyboard use it can see in the code. It can’t judge contrast or focus order in the running app.',
    ask: 'Missing names and labels, wrong roles, things a keyboard can’t reach. Only what the code shows: you aren’t running the app, so don’t guess at contrast or focus order. Skip this when the change touches no UI.',
  },
  { id: 'security', label: 'Security', detail: 'Injection, secrets, weak checks on who can do what, and unsafe handling of input.', ask: 'Injection, leaked secrets, missing or weak permission checks, unsafe handling of input.' },
  { id: 'performance', label: 'Performance', detail: 'Slow queries, repeated work and things that grow without a limit.', ask: 'Slow queries, repeated work, unbounded growth, on a path where it matters.' },
];

export const FINDING_LIMITS = [5, 10, 20];
export const DEFAULT_AI_REVIEW: AiReviewSettings = { enabled: true, areas: ['bugs', 'accessibility'], instructions: '', depth: 'thorough', maxFindings: 10 };

/** A project's settings with anything missing or unknown filled in. */
export function aiReviewSettings(saved?: Partial<AiReviewSettings> | null): AiReviewSettings {
  const known = REVIEW_AREAS.map((a) => a.id);
  return {
    enabled: saved?.enabled ?? DEFAULT_AI_REVIEW.enabled,
    areas: Array.isArray(saved?.areas) ? known.filter((id) => saved.areas!.includes(id)) : DEFAULT_AI_REVIEW.areas,
    instructions: typeof saved?.instructions === 'string' ? saved.instructions : '',
    depth: saved?.depth === 'quick' ? 'quick' : 'thorough',
    maxFindings: FINDING_LIMITS.includes(saved?.maxFindings as number) ? saved!.maxFindings! : DEFAULT_AI_REVIEW.maxFindings,
  };
}

export const areaLabel = (id: ReviewArea) => REVIEW_AREAS.find((a) => a.id === id)?.label ?? id;
export const notChecked = (areas: ReviewArea[]) => REVIEW_AREAS.filter((a) => !areas.includes(a.id)).map((a) => a.id);

const RANK = { high: 0, medium: 1, low: 2 } as const;
export const bySeverity = (a: Pick<AiFinding, 'severity'>, b: Pick<AiFinding, 'severity'>) => RANK[a.severity] - RANK[b.severity];

export interface PlacedFinding {
  finding: AiFinding;
  step: Step;
  commented: boolean;
}

export interface FindingsView {
  /** To look at, most serious first. */
  open: PlacedFinding[];
  dismissed: AiFinding[];
  /** On code that changed since the run, so they may not hold any more. */
  outdated: AiFinding[];
  /** The diff isn't the one the review saw. */
  stale: boolean;
}

/** A result against the diff as it is now. */
export function findingsView(result: AiReviewResult | null | undefined, data: Pick<ReviewData, 'hunks' | 'steps'>, comments: Comment[]): FindingsView {
  const view: FindingsView = { open: [], dismissed: [], outdated: [], stale: false };
  if (!result) return view;
  const now = Object.keys(data.hunks);
  const saw = new Set(result.hunkIds);
  view.stale = now.length !== saw.size || now.some((id) => !saw.has(id));
  for (const finding of [...result.findings].sort(bySeverity)) {
    if (finding.dismissed) {
      view.dismissed.push(finding);
      continue;
    }
    const step = data.hunks[finding.hunkId] ? data.steps.find((s) => s.hunkIds.includes(finding.hunkId)) : undefined;
    if (!step) view.outdated.push(finding);
    else view.open.push({ finding, step, commented: comments.some((c) => c.id === finding.commentId) });
  }
  return view;
}

/** Text for the comment you make of a finding. */
export const findingComment = (f: Pick<AiFinding, 'title' | 'fails'>) => `${f.title}\n\n${f.fails}`;

/** Text for the Ask panel, for you to read and send. */
export function findingAsk(f: Pick<AiFinding, 'title' | 'fails' | 'path' | 'line'>, kind: 'question' | 'change') {
  const what = `An AI review said this about ${f.path}, line ${f.line}: ${f.title}. ${f.fails}`;
  return kind === 'question' ? `${what}\n\nIs this a real problem? Check the code and tell me why or why not.` : `${what}\n\nFix this, if it's a real problem. If it isn't, change nothing and tell me why.`;
}

/** Applies what you did with a finding. `newId` makes the comment's id, so this stays pure. */
export function actOnFinding(r: ReviewState, patch: { id: string; action: 'dismiss' | 'restore' | 'uncomment' } | { id: string; action: 'comment'; stepKey: string }, newId: () => string, now: string) {
  const f = r.aiReview?.result?.findings.find((x) => x.id === patch.id);
  if (!f) return;
  const dropComment = () => {
    r.comments = r.comments.filter((c) => c.id !== f.commentId);
    f.commentId = null;
  };
  if (patch.action === 'dismiss') {
    f.dismissed = true;
    dropComment();
  } else if (patch.action === 'restore') f.dismissed = false;
  else if (patch.action === 'uncomment') dropComment();
  else if (patch.action === 'comment' && !r.comments.some((c) => c.id === f.commentId)) {
    const id = newId();
    r.comments.push({ id, stepKey: patch.stepKey, hunkId: f.hunkId, line: f.line, path: f.path, side: f.side, body: findingComment(f), createdAt: now });
    f.commentId = id;
  }
}
