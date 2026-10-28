import { readFileSync, existsSync } from 'node:fs';
import { collectHunks, defaultBase, resolveCommit, hunkRange, git } from './diff.mjs';
import { assessHunk, assessChange, SEVERITY } from './risk.mjs';

export const DEFAULT_WALKTHROUGH = '.review/walkthrough.json';

const SPECIFICITY = { hunk: 4, lines: 3, file: 2, dir: 1 };

export function loadWalkthrough(path) {
  if (!existsSync(path)) throw new UsageError(`No walkthrough at ${path}. Run "wtv init" or ask the agent to write one.`);
  let wt;
  try {
    wt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new UsageError(`Walkthrough is not valid JSON: ${e.message}`);
  }
  return normalizeWalkthrough(wt);
}

/** Validate and normalise a parsed walkthrough. Unknown fields are kept. */
export function normalizeWalkthrough(input) {
  if (!input || !Array.isArray(input.chapters)) throw new UsageError('Walkthrough needs a "chapters" array.');
  const strings = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((s) => s.trim());
  return {
    ...input,
    chapters: input.chapters.map((c, i) => ({
      title: c.title ?? `Chapter ${i + 1}`,
      why: c.why ?? '',
      risk: c.risk ?? null,
      refs: (c.hunks ?? c.refs ?? []).map(String),
      checks: strings(c.checks),
      outsideTask: c.outsideTask === true,
      // Agent notes per hunk, keyed by one of the chapter's refs: { "h:54b48929c1": "..." }
      notes: c.notes && typeof c.notes === 'object' && !Array.isArray(c.notes)
        ? Object.fromEntries(Object.entries(c.notes).filter(([, v]) => typeof v === 'string' && v.trim()))
        : {},
    })),
  };
}

export class UsageError extends Error {}

/** Resolve the range to review. head === null means the working tree. */
export function resolveRange({ cwd, base, head, walkthrough }) {
  const baseRef = base ?? walkthrough?.base ?? null;
  const baseSha = baseRef ? resolveCommit(baseRef, cwd) : defaultBase(cwd);
  const headSha = head ? resolveCommit(head, cwd) : null;
  return { base: baseSha, head: headSha };
}

export function matchRef(ref, hunks) {
  let m;
  if ((m = ref.match(/^h:([0-9a-f]{6,}(?:-\d+)?)$/i))) {
    const id = m[1].toLowerCase();
    return { kind: 'hunk', hunks: hunks.filter((h) => h.id === id || (h.id.startsWith(id) && !id.includes('-'))) };
  }
  if ((m = ref.match(/^(.+):(\d+)(?:-(\d+))?$/))) {
    const [, path, a, b] = m;
    const from = +a;
    const to = b ? +b : from;
    return {
      kind: 'lines',
      hunks: hunks.filter((h) => {
        if (h.path !== path) return false;
        if (h.synthetic) return true;
        const [s, e] = hunkRange(h);
        return s <= to && e >= from;
      }),
    };
  }
  const dir = ref.endsWith('/') ? ref : `${ref}/`;
  const exact = hunks.filter((h) => h.path === ref || h.oldPath === ref);
  if (exact.length) return { kind: 'file', hunks: exact };
  return { kind: 'dir', hunks: hunks.filter((h) => h.path.startsWith(dir)) };
}

export function verify({ cwd, walkthrough, base, head }) {
  const range = resolveRange({ cwd, base, head, walkthrough });
  const raw = collectHunks({ cwd, ...range });
  const hunks = raw.map((h) => ({ ...h, ...assessHunk(h), chapters: [], specificity: null, bucket: null }));
  const byId = new Map(hunks.map((h) => [h.id, h]));

  const findings = [];
  const phantoms = [];

  const chapters = walkthrough.chapters.map((c, index) => {
    const refs = c.refs.map((ref) => {
      const { kind, hunks: matched } = matchRef(ref, hunks);
      if (!matched.length) phantoms.push({ chapter: index, title: c.title, ref });
      for (const h of matched) {
        if (!h.chapters.includes(index)) h.chapters.push(index);
        if (!h.specificity || SPECIFICITY[kind] > SPECIFICITY[h.specificity]) h.specificity = kind;
      }
      return { ref, kind, matched: matched.map((h) => h.id) };
    });
    if (!c.why || /^todo\b/i.test(c.why.trim())) {
      findings.push({ code: 'missing-why', severity: 'medium', message: `Chapter "${c.title}" has no "why".` });
    }
    if (!c.refs.length) {
      findings.push({ code: 'empty-chapter', severity: 'medium', message: `Chapter "${c.title}" references nothing.` });
    }
    const hunkIds = [...new Set(refs.flatMap((r) => r.matched))];
    // A note must point at hunks this chapter covers, or the reviewer would see it in the wrong place.
    const notes = Object.entries(c.notes ?? {}).map(([ref, text]) => {
      const matched = matchRef(ref, hunks).hunks.map((h) => h.id).filter((id) => hunkIds.includes(id));
      if (!matched.length) {
        findings.push({ code: 'stray-note', severity: 'low', message: `Chapter "${c.title}" has a note for ${ref}, which is not one of its hunks.` });
      }
      return { ref, text, hunkIds: matched };
    });
    return {
      index,
      title: c.title,
      why: c.why,
      risk: c.risk,
      checks: c.checks ?? [],
      outsideTask: !!c.outsideTask,
      notes,
      refs,
      hunkIds,
    };
  });

  for (const h of hunks) {
    if (h.chapters.length) h.bucket = 'narrated';
    else if (h.whitespaceOnly) h.bucket = 'noise';
    else if (h.lockfile || h.generated) h.bucket = 'generated';
    else h.bucket = 'unnarrated';
  }

  const pick = (b) => hunks.filter((h) => h.bucket === b);
  const bySeverity = (a, b) => SEVERITY[b.level] - SEVERITY[a.level] || a.path.localeCompare(b.path) || a.newStart - b.newStart;

  const unnarrated = pick('unnarrated').sort(bySeverity);
  const weak = hunks
    .filter((h) => h.bucket === 'narrated' && h.level === 'high' && SPECIFICITY[h.specificity] <= SPECIFICITY.file)
    .sort(bySeverity);

  if (!walkthrough.intent || /^todo\b/i.test(String(walkthrough.intent).trim())) {
    findings.push({ code: 'missing-intent', severity: 'medium', message: 'Walkthrough has no "intent".' });
  }

  if (walkthrough.head && walkthrough.head !== 'worktree') {
    try {
      const narrated = resolveCommit(walkthrough.head, cwd);
      const now = range.head ?? resolveCommit('HEAD', cwd);
      if (narrated !== now) {
        const changed = git(['diff', '--name-only', narrated, now], cwd).split('\n').filter(Boolean);
        findings.push({
          code: 'stale',
          severity: 'low',
          message: `Walkthrough was written at ${narrated.slice(0, 7)}, now at ${now.slice(0, 7)}. ${changed.length} file(s) changed since. New content shows up below as unnarrated.`,
        });
      }
    } catch {
      findings.push({ code: 'stale', severity: 'low', message: `Walkthrough head ${walkthrough.head} no longer exists (rebased?).` });
    }
  }

  findings.push(...assessChange(hunks));

  const ok = unnarrated.length === 0 && phantoms.length === 0;

  return {
    ok,
    intent: walkthrough.intent ?? null,
    base: range.base,
    head: range.head ?? 'worktree',
    files: new Set(hunks.map((h) => h.path)).size,
    chapters,
    hunks,
    buckets: {
      narrated: pick('narrated').map((h) => h.id),
      unnarrated: unnarrated.map((h) => h.id),
      noise: pick('noise').map((h) => h.id),
      generated: pick('generated').map((h) => h.id),
      weak: weak.map((h) => h.id),
      phantom: phantoms,
    },
    findings,
    byId,
  };
}

/** Skeleton walkthrough: one chapter per file, every hunk referenced. */
export function skeleton({ cwd, base, head }) {
  const range = resolveRange({ cwd, base, head });
  const hunks = collectHunks({ cwd, ...range });
  const byFile = new Map();
  for (const h of hunks) {
    if (h.whitespaceOnly || h.lockfile || h.generated) continue;
    if (!byFile.has(h.path)) byFile.set(h.path, []);
    byFile.get(h.path).push(`h:${h.id}`);
  }
  let headSha = range.head;
  try {
    headSha ??= resolveCommit('HEAD', cwd);
  } catch {}
  return {
    version: 1,
    intent: 'TODO: one sentence on what this change is for',
    base: range.base,
    head: headSha,
    chapters: [...byFile].map(([path, refs]) => ({
      title: path,
      why: 'TODO',
      risk: null,
      checks: [],
      hunks: refs,
    })),
  };
}

export function listHunks({ cwd, base, head }) {
  const range = resolveRange({ cwd, base, head });
  return {
    ...range,
    head: range.head ?? 'worktree',
    hunks: collectHunks({ cwd, ...range }).map((h) => ({ ...h, ...assessHunk(h) })),
  };
}
