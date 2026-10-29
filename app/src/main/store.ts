// Review state in one JSON file. Small, readable, and written atomically.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { AppSettings, Project, ReviewState, Watch } from '../shared/types.ts';

interface Data {
  version: 1;
  projects: Project[];
  reviews: Record<string, ReviewState>;
  /** Missing in stores from before there were settings. */
  settings?: Partial<AppSettings>;
}

const DEFAULT_SETTINGS: AppSettings = { theme: 'system' };

const empty = (): Data => ({ version: 1, projects: [], reviews: {} });

/** A project's name: what you typed, trimmed, or the folder's name when that's empty. Two projects may share one. */
export const projectName = (name: string | undefined, root: string) => name?.trim() || basename(root);

/**
 * The project under a new name; `undefined` keeps the one it has. Reviews, ignored and tracked branches
 * hang off the id, so nothing else changes.
 */
export const withProjectName = (p: Project, name: string | undefined): Project => (name === undefined ? p : { ...p, name: projectName(name, p.path) });

/** A project's watch rules. Stores from before you could combine them have a single `mode`. */
export function toWatch(w: unknown): Watch {
  const o = (w ?? {}) as Record<string, unknown>;
  const pattern = typeof o.pattern === 'string' ? o.pattern : null;
  if (o.mode === 'pattern') return { anyBranch: false, pattern: pattern ?? '', pullRequests: false };
  if (o.mode === 'pull-requests') return { anyBranch: false, pattern: null, pullRequests: true };
  if (o.mode === 'agent-sessions') return { anyBranch: true, pattern: null, pullRequests: false };
  // The switches, or some of them: a missing one keeps its default. `agentSessions` is what any branch was called for a while.
  const anyBranch = typeof o.anyBranch === 'boolean' ? o.anyBranch : typeof o.agentSessions === 'boolean' ? o.agentSessions : true;
  return { anyBranch, pattern, pullRequests: o.pullRequests === true };
}

export const reviewId =(projectId: string, branch: string) => `${projectId}::${branch}`;

export class Store {
  private data: Data;
  private file: string;

  constructor(file: string) {
    this.file = file;
    this.data = this.load();
  }

  private load(): Data {
    if (!existsSync(this.file)) return empty();
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8'));
      if (d?.version !== 1) throw new Error(`Unknown store version ${d?.version}`);
      const data: Data = { ...empty(), ...d };
      data.projects = data.projects.map((p) => ({ ...p, watch: toWatch(p.watch) }));
      return data;
    } catch (e) {
      // Keep the unreadable file for inspection rather than overwriting it.
      renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      console.error('Store unreadable, starting fresh:', e);
      return empty();
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(tmp, this.file);
  }

  settings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.data.settings };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.settings();
  }

  projects(): Project[] {
    return this.data.projects;
  }

  project(id: string): Project {
    const p = this.data.projects.find((x) => x.id === id);
    if (!p) throw new Error(`Unknown project ${id}`);
    return p;
  }

  /** Adds a project, or replaces the one with the same id or path in place. */
  addProject(p: Project) {
    const i = this.data.projects.findIndex((x) => x.id === p.id || x.path === p.path);
    if (i >= 0) this.data.projects[i] = p;
    else this.data.projects.push(p);
    this.save();
  }

  removeProject(id: string) {
    this.data.projects = this.data.projects.filter((x) => x.id !== id);
    this.save();
  }

  reviews(): ReviewState[] {
    return Object.values(this.data.reviews);
  }

  review(projectId: string, branch: string): ReviewState | null {
    return this.data.reviews[reviewId(projectId, branch)] ?? null;
  }

  ensureReview(projectId: string, branch: string, init: Partial<ReviewState>): ReviewState {
    const id = reviewId(projectId, branch);
    const existing = this.data.reviews[id];
    if (existing) return existing;
    const r: ReviewState = {
      id,
      projectId,
      branch,
      sessionId: null,
      title: branch,
      order: 'story',
      startedAt: null,
      updatedAt: new Date().toISOString(),
      reviewed: {},
      comments: [],
      decision: null,
      status: 'open',
      summary: null,
      ...init,
    };
    this.data.reviews[id] = r;
    this.save();
    return r;
  }

  /**
   * Start a new pass over a branch you already finished, e.g. after the agent worked on your
   * feedback. The earlier round is kept; the new one starts clean. No-op while an agent run is going.
   */
  reopenReview(projectId: string, branch: string) {
    const r = this.data.reviews[reviewId(projectId, branch)];
    if (!r?.decision || r.decision.result === 'running') return;
    r.rounds = [...(r.rounds ?? []), { decision: r.decision, comments: r.comments, reviewed: r.reviewed }];
    Object.assign(r, { decision: null, comments: [], reviewed: {}, status: 'open', startedAt: null });
    this.save();
  }

  updateReview(projectId: string, branch: string, fn: (r: ReviewState) => void): ReviewState {
    const r = this.data.reviews[reviewId(projectId, branch)];
    if (!r) throw new Error(`No review for ${branch}`);
    fn(r);
    r.updatedAt = new Date().toISOString();
    this.save();
    return r;
  }
}
