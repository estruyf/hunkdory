// What the inbox shows for each branch, kept on disk by fingerprint. Without it every launch
// runs wtv on every branch before the inbox can show anything.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InboxItem } from '../shared/types.ts';

/** Bump when what goes into a summary changes, so old ones aren't trusted. */
const VERSION = 1;

export type Summary = Pick<InboxItem, 'title' | 'files' | 'added' | 'removed' | 'steps' | 'minutes' | 'flags' | 'walkthrough'> & { author: string | null };

interface Data {
  version: number;
  entries: Record<string, { key: string; summary: Summary }>;
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
