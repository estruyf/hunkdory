// Types for the parts of wtv (plain ESM in tools/wtv/src) the app uses.
declare module '@wtv/verify.mjs' {
  export function normalizeWalkthrough(input: unknown): unknown;
  export function verify(opts: { cwd: string; walkthrough: unknown; base?: string; head?: string | null }): WtvResult & { byId: Map<string, WtvHunk> };
  export function skeleton(opts: { cwd: string; base?: string; head?: string | null }): Record<string, unknown>;
  export class UsageError extends Error {}
}
declare module '@wtv/diff.mjs' {
  export function rangeLabel(h: WtvHunk): string;
  export function git(args: string[], cwd: string): string;
}

interface WtvHunk {
  id: string;
  path: string;
  oldPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  untracked: boolean;
  synthetic: string | null;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  removed: string[];
  added: string[];
  whitespaceOnly: boolean;
  lockfile: boolean;
  generated: boolean;
  risks: { code: string; severity: 'high' | 'medium' | 'low'; label: string }[];
  level: 'high' | 'medium' | 'low' | 'none';
  chapters: number[];
  bucket: 'narrated' | 'unnarrated' | 'noise' | 'generated';
}

interface WtvChapter {
  index: number;
  title: string;
  why: string;
  risk: string | null;
  checks: string[];
  outsideTask: boolean;
  notes: { ref: string; text: string; hunkIds: string[] }[];
  refs: { ref: string; kind: string; matched: string[] }[];
  hunkIds: string[];
}

interface WtvResult {
  ok: boolean;
  intent: string | null;
  base: string;
  head: string;
  files: number;
  chapters: WtvChapter[];
  hunks: WtvHunk[];
  buckets: {
    narrated: string[];
    unnarrated: string[];
    noise: string[];
    generated: string[];
    weak: string[];
    phantom: { chapter: number; title: string; ref: string }[];
  };
  findings: { code: string; severity: 'high' | 'medium' | 'low'; message: string }[];
}
