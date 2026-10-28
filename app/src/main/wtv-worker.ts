// Runs wtv off the main thread: its git calls are synchronous.
import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeWalkthrough, skeleton, verify } from '@wtv/verify.mjs';
import { git } from '@wtv/diff.mjs';
import { diffLines, rangeText } from './steps.ts';
import type { DiffLine } from '../shared/types.ts';

export interface WtvJob {
  id: number;
  /** Repository (or worktree) to run in. */
  cwd: string;
  baseSha: string;
  /** null = working tree of `cwd`, including uncommitted and untracked files. */
  head: string | null;
  /** Parsed walkthrough, or null to use wtv's skeleton. */
  walkthrough: unknown | null;
}

export interface WtvOutput {
  result: WtvResult;
  source: 'agent' | 'skeleton';
  lines: Record<string, DiffLine[]>;
  ranges: Record<string, string>;
}

function run(job: WtvJob): WtvOutput {
  const { cwd, baseSha, head } = job;
  const source = job.walkthrough ? 'agent' : 'skeleton';
  const wt = normalizeWalkthrough(job.walkthrough ?? skeleton({ cwd, base: baseSha, head }));
  const { byId: _byId, ...result } = verify({ cwd, walkthrough: wt, base: baseSha, head });

  const show = (rev: string, path: string) => {
    try {
      return git(['show', `${rev}:${path}`], cwd);
    } catch {
      return null;
    }
  };
  const oldCache = new Map<string, string | null>();
  const newCache = new Map<string, string | null>();
  const oldText = (p: string) => (oldCache.has(p) ? oldCache.get(p)! : (oldCache.set(p, show(baseSha, p)), oldCache.get(p)!));
  const newText = (p: string) => {
    if (!newCache.has(p)) {
      let text: string | null = null;
      if (head) text = show(head, p);
      else {
        try {
          text = readFileSync(join(cwd, p), 'utf8');
        } catch {}
      }
      newCache.set(p, text);
    }
    return newCache.get(p)!;
  };

  const lines: Record<string, DiffLine[]> = {};
  const ranges: Record<string, string> = {};
  for (const h of result.hunks) {
    const before = h.status === 'added' || h.synthetic ? null : oldText(h.oldPath ?? h.path);
    const after = h.status === 'deleted' || h.synthetic ? null : newText(h.path);
    lines[h.id] = diffLines(h, before, after);
    const total = after === null ? null : after.split('\n').length - (after.endsWith('\n') ? 1 : 0);
    ranges[h.id] = rangeText(h, total);
  }
  return { result, source, lines, ranges };
}

parentPort?.on('message', (job: WtvJob) => {
  try {
    parentPort!.postMessage({ id: job.id, ok: true, value: run(job) });
  } catch (e) {
    const err = e as Error & { stderr?: unknown };
    const message = err.stderr ? `git failed: ${String(err.stderr).trim()}` : err.message;
    parentPort!.postMessage({ id: job.id, ok: false, error: message });
  }
});
