// Diff rows for display: side by side, and with whitespace-only edits folded away. Pure.
import type { DiffLine, Risk } from './types.ts';

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Context on both sides; a run of removed lines pairs up with the added lines after it. */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (l.kind === 'ctx') {
      rows.push({ left: l, right: l });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * A removed line and the added line it pairs with that differ only in whitespace become one
 * unchanged line, showing the new text. Everything else stays as it is.
 */
export function ignoreWhitespace(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind === 'ctx') {
      out.push(lines[i++]);
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    const n = Math.min(dels.length, adds.length);
    const same = (k: number) => squash(dels[k].text) === squash(adds[k].text);
    if (n === dels.length && n === adds.length && Array.from({ length: n }, (_, k) => same(k)).every(Boolean)) {
      for (let k = 0; k < n; k++) out.push({ kind: 'ctx', oldN: dels[k].oldN, newN: adds[k].newN, text: adds[k].text });
    } else out.push(...dels, ...adds);
  }
  return out;
}

const LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  ps1: 'powershell', psm1: 'powershell', dockerfile: 'dockerfile', makefile: 'makefile',
};

/** The highlight.js language for a path, or null to show plain text. */
export function languageFor(path: string): string | null {
  const name = path.split('/').pop()!.toLowerCase();
  if (name === 'dockerfile' || name === 'makefile') return LANGS[name];
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return LANGS[ext] ?? null;
}

/** "Matched “role” on line 68", to say why a risk tag is there. */
export function riskReason(r: Pick<Risk, 'match'>, path?: string) {
  if (!r.match) return null;
  const where = r.match.line === null ? ' in the path' : ` on line ${r.match.line}${path ? ` of ${path.split('/').pop()}` : ''}`;
  return `Matched “${r.match.term}”${where}`;
}
