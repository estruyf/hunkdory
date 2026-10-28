import { rangeLabel } from './diff.mjs';

const useColor = () => !process.env.NO_COLOR && (process.env.FORCE_COLOR || process.stdout.isTTY);
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  dim: paint('2'),
  bold: paint('1'),
};

const LEVEL = {
  high: (s) => c.red(c.bold(s)),
  medium: c.yellow,
  low: c.dim,
  none: c.dim,
};

const where = (h) => `${h.path}:${rangeLabel(h)}`;
const short = (sha) => (sha === 'worktree' ? 'working tree' : sha.slice(0, 7));
const tags = (h) => (h.risks.length ? h.risks.map((r) => r.label).join(', ') : '');

function preview(h, max = 4) {
  if (h.synthetic) return [c.dim(`      (${h.synthetic}${h.status === 'renamed' ? ` from ${h.oldPath}` : ''})`)];
  const lines = [
    ...h.removed.map((l) => c.red(`      - ${l.trimEnd()}`)),
    ...h.added.map((l) => c.green(`      + ${l.trimEnd()}`)),
  ];
  const out = lines.slice(0, max).map((l) => (l.length > 110 ? `${l.slice(0, 107)}...` : l));
  if (lines.length > max) out.push(c.dim(`      ... ${lines.length - max} more line(s)`));
  return out;
}

function hunkLine(h) {
  const lvl = (h.level === 'none' ? '' : h.level.toUpperCase()).padEnd(6);
  const t = tags(h);
  const state = h.untracked ? c.yellow(' (untracked)') : h.status === 'added' ? c.dim(' (new)') : h.status === 'deleted' ? c.dim(' (deleted)') : '';
  return `  ${LEVEL[h.level](lvl)} ${c.bold(where(h))}${state}${t ? `  ${LEVEL[h.level](`[${t}]`)}` : ''}  ${c.dim(`h:${h.id}`)}`;
}

export function printVerify(r, { hook = false } = {}) {
  const out = [];
  const { buckets, byId } = r;
  const get = (ids) => ids.map((id) => byId.get(id));

  if (!hook) {
    out.push(c.bold('wtv · walkthrough verify'));
    if (r.intent) out.push(`Intent: ${r.intent}`);
    out.push(c.dim(`Range:  ${short(r.base)}..${short(r.head)} · ${r.hunks.length} hunks in ${r.files} files`));
    out.push('');
  }

  const unnarrated = get(buckets.unnarrated);
  if (unnarrated.length) {
    out.push(c.red(c.bold(`✗ ${unnarrated.length} unnarrated hunk(s). The walkthrough doesn't explain these:`)));
    for (const h of unnarrated) {
      out.push(hunkLine(h));
      out.push(...preview(h));
    }
    out.push('');
  }

  if (buckets.phantom.length) {
    out.push(c.red(c.bold(`✗ ${buckets.phantom.length} phantom claim(s). These refs match nothing in the diff:`)));
    for (const p of buckets.phantom) out.push(`  "${p.title}" → ${c.bold(p.ref)}`);
    out.push('');
  }

  const weak = get(buckets.weak);
  if (weak.length) {
    out.push(c.yellow(c.bold(`⚠ ${weak.length} risky hunk(s) only covered by a whole-file or folder ref:`)));
    for (const h of weak) out.push(hunkLine(h));
    out.push('');
  }

  const notes = r.findings;
  if (notes.length) {
    for (const f of notes) out.push(`${f.severity === 'low' ? c.dim('·') : c.yellow('⚠')} ${f.message}`);
    out.push('');
  }

  if (!hook) {
    out.push(c.green(`✓ ${buckets.narrated.length} narrated hunk(s) in ${r.chapters.length} chapter(s)`));
    for (const ch of r.chapters) {
      const hs = ch.hunkIds.map((id) => byId.get(id));
      const worst = hs.reduce((m, h) => (h.level === 'high' ? 'high' : h.level === 'medium' && m !== 'high' ? 'medium' : m), 'none');
      const mark = worst === 'none' ? '' : ` ${LEVEL[worst](`(${worst} risk)`)}`;
      out.push(`  ${ch.index + 1}. ${ch.title} ${c.dim(`· ${hs.length} hunk(s)`)}${mark}`);
    }
    const extra = [];
    if (buckets.noise.length) extra.push(`${buckets.noise.length} whitespace-only`);
    if (buckets.generated.length) extra.push(`${buckets.generated.length} generated or lockfile`);
    if (extra.length) out.push(c.dim(`· skipped ${extra.join(', ')} hunk(s)`));
    out.push('');
    out.push(r.ok ? c.green(c.bold('PASS')) : c.red(c.bold('FAIL')) + c.dim('  fix the walkthrough or the code, then run again'));
  } else if (!r.ok) {
    out.push(
      'Update .review/walkthrough.json so every hunk above belongs to a chapter with a "why", ' +
        'or revert the change if it was not intended. Remove refs that match nothing. ' +
        'Use "h:<id>" refs from "wtv list". Then stop again.'
    );
  }
  return out.join('\n');
}

export function printList(r) {
  const out = [c.dim(`Range: ${short(r.base)}..${short(r.head)} · ${r.hunks.length} hunks`), ''];
  let file = null;
  for (const h of r.hunks) {
    if (h.path !== file) {
      file = h.path;
      out.push(c.bold(`${h.path}${h.status !== 'modified' ? c.dim(` (${h.status}${h.untracked ? ', untracked' : ''})`) : ''}`));
    }
    const flags = [h.whitespaceOnly && 'whitespace', h.lockfile && 'lockfile', h.generated && 'generated'].filter(Boolean);
    out.push(
      `  h:${h.id}  ${rangeLabel(h).padEnd(9)} ${c.green(`+${h.added.length}`)} ${c.red(`-${h.removed.length}`)}` +
        `${h.risks.length ? `  ${LEVEL[h.level](`[${tags(h)}]`)}` : ''}${flags.length ? c.dim(`  (${flags.join(', ')})`) : ''}`
    );
  }
  return out.join('\n');
}

/** JSON contract for a UI. Self-contained: no Map, full hunk content. */
export function toJson(r) {
  const { byId, ...rest } = r;
  return JSON.stringify(rest, null, 2);
}
