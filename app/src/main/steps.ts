// wtv verify result → review steps and "Needs your attention" flags. Pure.
import type { AttentionFlag, DiffLine, RiskLevel, Step, WalkthroughSource } from '../shared/types.ts';

const RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;
const maxLevel = (levels: (keyof typeof RANK)[]): RiskLevel => {
  const top = levels.reduce<keyof typeof RANK>((m, l) => (RANK[l] > RANK[m] ? l : m), 'none');
  return top === 'none' ? 'low' : top;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
const isTodo = (s: string | null | undefined) => !s || /^todo\b/i.test(s.trim());

/**
 * Every changed hunk ends up in at least one step:
 * walkthrough chapters in the agent's order, then one "outside the task" step per file
 * with hunks the walkthrough doesn't explain, then whitespace-only and generated hunks.
 */
export function buildSteps(r: WtvResult, source: WalkthroughSource): Step[] {
  const byId = new Map(r.hunks.map((h) => [h.id, h]));
  const steps: Step[] = [];
  const keys = new Set<string>();
  const uniqueKey = (k: string) => {
    let key = k;
    for (let n = 2; keys.has(key); n++) key = `${k}-${n}`;
    keys.add(key);
    return key;
  };

  const make = (s: Omit<Step, 'index' | 'files' | 'added' | 'removed' | 'risk'> & { minRisk?: RiskLevel }): Step => {
    const hs = s.hunkIds.map((id) => byId.get(id)!).filter(Boolean);
    const { minRisk, ...rest } = s;
    return {
      ...rest,
      index: steps.length,
      risk: maxLevel([...hs.map((h) => h.level), minRisk ?? 'none']),
      files: [...new Set(hs.map((h) => h.path))],
      added: hs.reduce((n, h) => n + h.added.length, 0),
      removed: hs.reduce((n, h) => n + h.removed.length, 0),
    };
  };

  for (const ch of r.chapters) {
    const skeleton = source === 'skeleton';
    const checks = ch.checks.length ? ch.checks : ch.risk && !isTodo(ch.risk) ? [ch.risk] : [];
    steps.push(
      make({
        key: uniqueKey(skeleton ? `file:${ch.title}` : `ch:${slug(ch.title)}`),
        title: ch.title,
        why: isTodo(ch.why) ? '' : ch.why,
        checks,
        outsideTask: ch.outsideTask,
        minRisk: ch.outsideTask ? 'medium' : undefined,
        source: skeleton ? 'skeleton' : 'chapter',
        hunkIds: ch.hunkIds,
      })
    );
  }

  const unnarrated = new Map<string, string[]>();
  for (const id of r.buckets.unnarrated) {
    const h = byId.get(id)!;
    if (!unnarrated.has(h.path)) unnarrated.set(h.path, []);
    unnarrated.get(h.path)!.push(id);
  }
  for (const [path, ids] of [...unnarrated].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hs = ids.map((id) => byId.get(id)!);
    const what = hs[0].untracked ? 'added this file but never committed or mentioned it' : `changed this file in ${ids.length} place${ids.length > 1 ? 's' : ''}`;
    const labels = [...new Set(hs.flatMap((h) => h.risks.map((x) => x.label)))];
    steps.push(
      make({
        key: uniqueKey(`out:${path}`),
        title: `Not in the walkthrough: ${path}`,
        why: source === 'reviewer' ? `This file changed in ${ids.length} place${ids.length > 1 ? 's' : ''} that the walkthrough Reviewer wrote doesn't cover.` : `The agent ${what}, but the walkthrough doesn't explain it.`,
        checks: ['Did you ask for this? If not, drop it before merging.', ...labels.map((l) => `wtv flags: ${l}.`)],
        outsideTask: true,
        minRisk: 'medium',
        source: 'unnarrated',
        hunkIds: ids,
      })
    );
  }

  // wtv skips these when verifying, but a reviewer should still be able to see them.
  const skipped = [...r.buckets.noise, ...r.buckets.generated];
  if (skipped.length) {
    steps.push(
      make({
        key: uniqueKey('skipped'),
        title: 'Formatting and generated files',
        why: 'Whitespace-only changes, lockfiles and build output. Nobody needs to narrate these, but they are part of the change.',
        checks: r.buckets.generated.length ? ['Lockfile changes should line up with the dependency changes above.'] : [],
        outsideTask: false,
        source: 'skipped',
        hunkIds: skipped,
      })
    );
  }
  return steps;
}

const FINDING_TITLES: Record<string, string> = {
  'missing-why': 'Step without a reason',
  'empty-chapter': 'Empty step',
  'missing-intent': 'No stated goal',
  stale: 'Walkthrough is out of date',
  'lockfile-only': 'Lockfile changed on its own',
  'no-tests': 'No tests changed',
  'stray-note': 'Agent note in the wrong place',
};

export function attention(r: WtvResult, steps: Step[], source: WalkthroughSource): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  const stepOf = (id: string) => steps.find((s) => s.hunkIds.includes(id));
  const stepNames = (ids: string[]) => {
    const ns = [...new Set(ids.map((id) => stepOf(id)?.index).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
    return ns.length ? `${ns.length > 1 ? 'steps' : 'step'} ${ns.map((n) => n + 1).join(', ')}` : '';
  };

  for (const s of steps.filter((s) => s.outsideTask)) {
    flags.push({
      severity: 'medium',
      title: 'Change outside your request',
      detail: `Step ${s.index + 1} changes ${s.files.join(', ')}.`,
      stepKey: s.key,
    });
  }

  // One flag per risk type, listing where it happens.
  const byCode = new Map<string, { label: string; severity: RiskLevel; hunks: WtvHunk[] }>();
  for (const h of r.hunks) {
    for (const risk of h.risks) {
      if (risk.severity === 'low') continue;
      const g = byCode.get(risk.code) ?? { label: risk.label, severity: risk.severity, hunks: [] };
      if (RANK[risk.severity] > RANK[g.severity]) g.severity = risk.severity;
      g.hunks.push(h);
      byCode.set(risk.code, g);
    }
  }
  for (const [, g] of [...byCode].sort((a, b) => RANK[b[1].severity] - RANK[a[1].severity])) {
    const files = [...new Set(g.hunks.map((h) => h.path))];
    const where = files.length > 2 ? `${files.slice(0, 2).join(', ')} and ${files.length - 2} more` : files.join(', ');
    const ids = g.hunks.map((h) => h.id);
    flags.push({
      severity: g.severity === 'high' ? 'high' : 'medium',
      title: g.label,
      detail: `${where}${stepNames(ids) ? ` in ${stepNames(ids)}` : ''}.`,
      stepKey: stepOf(ids[0])?.key ?? null,
    });
  }

  for (const p of r.buckets.phantom) {
    flags.push({
      severity: 'high',
      title: 'Claim with no matching change',
      detail: `"${p.title}" points at ${p.ref}, which didn't change.`,
      stepKey: steps.find((s) => s.source === 'chapter' && s.index === p.chapter)?.key ?? null,
    });
  }

  if (r.buckets.weak.length) {
    flags.push({
      severity: 'medium',
      title: 'Risky change only loosely explained',
      detail: `The walkthrough covers ${r.buckets.weak.length} risky hunk(s) with a whole-file ref only, in ${stepNames(r.buckets.weak)}.`,
      stepKey: stepOf(r.buckets.weak[0])?.key ?? null,
    });
  }

  // The skeleton has no reasons by design; the UI already says so.
  const skip = source === 'skeleton' ? new Set(['missing-why', 'missing-intent']) : new Set<string>();
  for (const f of r.findings) {
    if (skip.has(f.code)) continue;
    flags.push({ severity: f.severity === 'high' ? 'high' : 'medium', title: FINDING_TITLES[f.code] ?? 'Note from wtv', detail: f.message, stepKey: null });
  }
  return flags;
}

/** Rough reading time: half a minute per step plus 25 lines a minute. Lockfiles, build output and reformatting don't count. */
export function estimateMinutes(steps: Step[], hunks: WtvHunk[]): number {
  const lines = hunks.filter((h) => !h.lockfile && !h.generated && !h.whitespaceOnly).reduce((n, h) => n + h.added.length + h.removed.length, 0);
  return Math.max(1, Math.round(steps.length * 0.5 + lines / 25));
}

/**
 * Rows for one hunk, with a few unchanged lines around it.
 * wtv diffs with zero context, so the context comes from the old and new file contents.
 */
export function diffLines(h: WtvHunk, oldText: string | null, newText: string | null, context = 3): DiffLine[] {
  if (h.synthetic) return [];
  const oldLines = oldText?.split('\n') ?? [];
  const newLines = newText?.split('\n') ?? [];
  // With -U0, a count of 0 means "after this line", otherwise the hunk starts at that line.
  const oldBefore = h.oldCount === 0 ? h.oldStart : h.oldStart - 1;
  const newBefore = h.newCount === 0 ? h.newStart : h.newStart - 1;
  const rows: DiffLine[] = [];
  const ctxSource = newText !== null ? newLines : oldLines;
  const ctxOffset = newText !== null ? newBefore : oldBefore;

  for (let i = Math.max(0, ctxOffset - context); i < ctxOffset; i++) {
    const delta = i - ctxOffset;
    rows.push({ kind: 'ctx', oldN: oldBefore + delta + 1, newN: newBefore + delta + 1, text: ctxSource[i] ?? '' });
  }
  h.removed.forEach((text, i) => rows.push({ kind: 'del', oldN: h.oldStart + i, newN: null, text }));
  h.added.forEach((text, i) => rows.push({ kind: 'add', oldN: null, newN: h.newStart + i, text }));
  const afterOld = oldBefore + h.oldCount;
  const afterNew = newBefore + h.newCount;
  const afterStart = newText !== null ? afterNew : afterOld;
  const lastLine = ctxSource.length - (ctxSource.at(-1) === '' ? 1 : 0);
  for (let i = 0; i < context && afterStart + i < lastLine; i++) {
    rows.push({ kind: 'ctx', oldN: afterOld + i + 1, newN: afterNew + i + 1, text: ctxSource[afterStart + i] });
  }
  // Context for brand-new or deleted files has no counterpart line.
  if (h.status === 'added') for (const r of rows) if (r.kind === 'ctx') r.oldN = null;
  if (h.status === 'deleted') for (const r of rows) if (r.kind === 'ctx') r.newN = null;
  return rows;
}

export function rangeText(h: WtvHunk, totalNew: number | null): string {
  if (h.synthetic === 'binary') return 'binary file';
  if (h.synthetic === 'rename') return `renamed from ${h.oldPath}`;
  if (h.synthetic) return `${h.synthetic} change`;
  if (h.status === 'added') return `new file · ${totalNew ?? h.newCount} lines${h.untracked ? ' · not committed' : ''}`;
  if (h.status === 'deleted') return `deleted file · ${h.oldCount} lines`;
  const [a, b] = h.newCount === 0 ? [h.oldStart, h.oldStart + h.oldCount - 1] : [h.newStart, h.newStart + h.newCount - 1];
  const prefix = h.newCount === 0 ? 'removed lines' : 'lines';
  return a === b ? `${prefix === 'lines' ? 'line' : 'removed line'} ${a}` : `${prefix} ${a}–${b}`;
}
