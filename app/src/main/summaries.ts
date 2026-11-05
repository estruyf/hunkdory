// What the inbox shows for each branch, kept on disk by fingerprint. Without it every launch
// runs wtv on every branch before the inbox can show anything. The last full inbox is kept too:
// even with every summary known, a scan still waits on git and gh, so a launch shows that one first.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InboxItem, Project, ReviewState } from '../shared/types.ts';
import type { InboxScan } from './projects.ts';

/** Bump when what goes into a summary changes, so old ones aren't trusted. */
// 2: recalibrated risk tags and the new flag wording.
const VERSION = 2;

export type Summary = Pick<InboxItem, 'title' | 'files' | 'added' | 'removed' | 'steps' | 'minutes' | 'flags' | 'walkthrough'> & { author: string | null };

interface Data {
  version: number;
  entries: Record<string, { key: string; summary: Summary }>;
  lastScan?: InboxScan;
}

/**
 * A saved inbox as it stands today. Git and GitHub have to wait for the scan, but what Hunkdory itself keeps
 * can't lag behind: projects you removed or renamed, branches you ignored, reviews you finished since.
 */
export function asOfNow(scan: InboxScan, projects: Project[], reviewOf: (projectId: string, branch: string) => ReviewState | null | undefined): InboxScan {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const items = scan.items.flatMap((item) => {
    const project = byId.get(item.projectId);
    if (!project) return [];
    const state = reviewOf(item.projectId, item.branch);
    // One that was already finished in the scan is listed because it changed since: that still holds.
    const finished = state?.status === 'merged' || state?.status === 'discarded' || state?.status === 'reviewed';
    if (finished && item.review?.status !== state.status) return [];
    return [{ ...item, projectName: project.name, ignored: !!project.ignored?.includes(item.branch), review: state ? { status: state.status, reviewedSteps: Object.keys(state.reviewed).length } : item.review }];
  });
  return { ...scan, items, scans: scan.scans.filter((s) => byId.has(s.projectId)) };
}

export class Summaries {
  private file: string;
  private data: Data;
  private timer: NodeJS.Timeout | null = null;

  constructor(file: string) {
    this.file = file;
    this.data = this.load();
  }

  private load(): Data {
    try {
      const d = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : null;
      if (d?.version === VERSION && d.entries) return d;
    } catch {}
    // Only a cache: anything unreadable is rebuilt.
    return { version: VERSION, entries: {} };
  }

  get(id: string, key: string): Summary | null {
    const e = this.data.entries[id];
    return e?.key === key ? e.summary : null;
  }

  set(id: string, key: string, summary: Summary) {
    this.data.entries[id] = { key, summary };
    this.schedule();
  }

  get lastScan(): InboxScan | null {
    return this.data.lastScan ?? null;
  }

  rememberScan(scan: InboxScan) {
    this.data.lastScan = scan;
    this.schedule();
  }

  /** Drops entries for branches no longer in any inbox. */
  keepOnly(ids: Set<string>) {
    const gone = Object.keys(this.data.entries).filter((id) => !ids.has(id));
    for (const id of gone) delete this.data.entries[id];
    if (gone.length) this.schedule();
  }

  // An inbox refresh sets many at once: write once at the end.
  private schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.save();
    }, 500);
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      console.error('Could not save inbox summaries:', e);
    }
  }
}
