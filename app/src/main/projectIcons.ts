// A project's icon: found in the repo as Seshboard finds it, or one you picked. A repo decides what its files are and
// what its settings point at, so nothing here reads outside it, follows a link out of it, or reads without a limit.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative } from 'node:path';
import { shrinkPng } from './pngShrink.ts';
import type { ProjectIconChoice, ProjectIconInfo, ProjectIconValue, StoredProjectIcon } from '../shared/types.ts';

/** Icons travel to the window as data URLs, so keep them small. */
export const MAX_ICON_BYTES = 200_000;
/** A larger PNG (an app's 1024-pixel icon) is scaled down to this many pixels a side instead of being turned away. */
export const ICON_SIZE = 128;
/** Past this, a PNG isn't worth reading to scale down. */
export const MAX_PNG_BYTES = 20_000_000;
/** How large a settings file read from a repo may be: far more than any real one. */
const MAX_REPO_FILE_BYTES = 1024 * 1024;

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** The image types an icon can be, for the file picker. */
export const ICON_EXTENSIONS = Object.keys(MIME).map((e) => e.slice(1));

/** Conventional icon locations inside one package, best first (vector before bitmap, app icons before favicons). */
const PACKAGE_CANDIDATES = [
  'public/favicon.svg',
  'public/icon.svg',
  'public/logo.svg',
  'src/app/icon.svg',
  'app/icon.svg',
  'static/favicon.svg',
  'favicon.svg',
  'icon.svg',
  'logo.svg',
  'assets/icon.svg',
  'assets/logo.svg',
  '.github/logo.svg',
  'public/favicon.png',
  'public/apple-touch-icon.png',
  'public/icon.png',
  'public/logo.png',
  'src/app/icon.png',
  'app/icon.png',
  'static/favicon.png',
  'icon.png',
  'logo.png',
  'assets/icon.png',
  'assets/logo.png',
  '.github/logo.png',
  'build/icon.png',
  'resources/icon.png',
  'Resources/AppIcon.png',
  'Resources/icon.png',
  'public/favicon.ico',
  'src/app/favicon.ico',
  'app/favicon.ico',
  'static/favicon.ico',
  'favicon.ico',
];

/** Folders holding one package each, for monorepos. */
const WORKSPACE_DIRS = ['apps', 'packages'];
/** Folders that are the one package, for a repo with its app in a subfolder. */
const PACKAGE_DIRS = ['app', 'web', 'site', 'client', 'frontend'];

/**
 * A small settings file a repo holds. A link to `/dev/zero` would never finish reading and one to a private file would
 * be read, so it must be a regular file, not a link, within the limit. Opened without following a link and without
 * waiting on a FIFO, then checked on what was opened, so it can't be swapped in between. Windows has no O_NOFOLLOW,
 * so there a link is turned away before it is opened.
 */
function readRepoFile(path: string): string | null {
  let fd: number;
  try {
    if (process.platform === 'win32' && lstatSync(path).isSymbolicLink()) return null;
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPO_FILE_BYTES) return null;
    const data = Buffer.alloc(stat.size);
    const read = readSync(fd, data, 0, stat.size, 0);
    return data.toString('utf8', 0, read);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const text = readRepoFile(path);
    return text === null ? null : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Whether `path` is inside `root`, also after following links: a repo's settings pick the path, and the file goes to the window. */
function within(root: string, path: string): boolean {
  const inside = (base: string, target: string) => {
    const rel = relative(base, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (!inside(root, path)) return false;
  try {
    return inside(realpathSync(root), realpathSync(path));
  } catch {
    return false;
  }
}

/** Checked in this order, so a link out of the repo is never read to find out whether it's a usable image. */
const usableIn = (root: string, path: string) => within(root, path) && iconDataUrl(path) !== null;

/** An icon the package declares: `iconPath` in Hunkdory's or Seshboard's settings or t3.json, or package.json `icon` (VS Code extensions). */
function declaredIcon(dir: string, root: string): string | null {
  for (const [file, key] of [
    ['.hunkdory.json', 'iconPath'],
    ['.seshboard.json', 'iconPath'],
    ['t3.json', 'iconPath'],
    ['package.json', 'icon'],
  ] as const) {
    const value = readJson(join(dir, file))?.[key];
    if (typeof value === 'string' && value && !value.startsWith('http')) {
      const path = join(dir, value);
      if (usableIn(root, path)) return path;
    }
  }
  return null;
}

const conventionalIcon = (dir: string, root: string) => PACKAGE_CANDIDATES.map((c) => join(dir, c)).find((path) => usableIn(root, path)) ?? null;

/** Finds a project's icon: declared at the root, then by convention there, then the same in its app folder and its workspace packages. */
export function detectIconPath(root: string): string | null {
  const atRoot = declaredIcon(root, root) ?? conventionalIcon(root, root);
  if (atRoot) return atRoot;
  for (const name of PACKAGE_DIRS) {
    const found = declaredIcon(join(root, name), root) ?? conventionalIcon(join(root, name), root);
    if (found) return found;
  }
  for (const workspace of WORKSPACE_DIRS) {
    let names: string[];
    try {
      names = readdirSync(join(root, workspace)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = join(root, workspace, name);
      const found = declaredIcon(dir, root) ?? conventionalIcon(dir, root);
      if (found) return found;
    }
  }
  return null;
}

/** An image's bytes as an icon: as they are when small enough, a large PNG scaled down, or null when it can't be one. */
export function fitIcon(ext: string, data: Buffer): Buffer | null {
  const type = ext.toLowerCase();
  if (!data.length || !(type in MIME)) return null;
  if (data.length <= MAX_ICON_BYTES) return data;
  if (type !== '.png' || data.length > MAX_PNG_BYTES) return null;
  const small = shrinkPng(data, ICON_SIZE);
  return small && small.length <= MAX_ICON_BYTES ? small : null;
}

/** Large PNGs scaled down, by path, until the file changes: the inbox asks for its icons often. */
const shrunk = new Map<string, { mtimeMs: number; size: number; icon: ProjectIconValue | null }>();

export function iconDataUrl(path: string): ProjectIconValue | null {
  const stat = statSync(path, { throwIfNoEntry: false });
  const ext = extname(path).toLowerCase();
  if (!stat?.isFile() || !stat.size || !(ext in MIME)) return null;
  const toUrl = (data: Buffer | null): ProjectIconValue | null => (data ? { kind: 'image', dataUrl: `data:${MIME[ext]};base64,${data.toString('base64')}` } : null);
  const read = () => {
    try {
      return fitIcon(ext, readFileSync(path));
    } catch {
      return null;
    }
  };
  if (stat.size <= MAX_ICON_BYTES) return toUrl(read());
  if (ext !== '.png' || stat.size > MAX_PNG_BYTES) return null;
  const hit = shrunk.get(path);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.icon;
  const icon = toUrl(read());
  shrunk.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, icon });
  return icon;
}

/** What a repo shows when you haven't picked anything. */
export function detectedIcon(root: string): ProjectIconInfo {
  const path = detectIconPath(root);
  const icon = path ? iconDataUrl(path) : null;
  return icon ? { icon, source: 'detected', path: relative(root, path!) } : { icon: null, source: null, path: null };
}

/** What a project shows: what you picked, or what its repo has. */
export function projectIconInfo(project: { path: string; icon?: StoredProjectIcon }): ProjectIconInfo {
  const stored = project.icon;
  if (stored?.kind === 'none') return { icon: null, source: 'custom', path: null };
  if (stored?.kind === 'emoji') return { icon: { kind: 'emoji', value: stored.value }, source: 'custom', path: null };
  if (stored?.kind === 'file') {
    const icon = iconDataUrl(stored.path);
    // The copy is gone, say a restored backup without it: back to what the repo has.
    if (icon) return { icon, source: 'custom', path: null };
  }
  return detectedIcon(project.path);
}

let folder: string | null = null;
/** Where picked images are copied to, so an icon survives the original being moved or deleted. */
export function useIconFolder(path: string) {
  folder = path;
}
const iconFolder = () => (folder ??= join(tmpdir(), 'hunkdory-icons'));

/** Why this file can't be an icon, or null. */
function refusal(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (!(ext in MIME)) return 'Use an SVG, PNG, ICO, JPEG, WebP or GIF image.';
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return `Not a file: ${path}`;
  if (stat.size > (ext === '.png' ? MAX_PNG_BYTES : MAX_ICON_BYTES)) return ext === '.png' ? 'That image is too large. Use one under 20 MB.' : 'Icons must be 200 KB or smaller, unless they are a PNG.';
  return null;
}

/** An image you picked, as it would show, without keeping it yet. Throws when it can't be an icon. */
export function previewIconFile(path: string): ProjectIconValue {
  const why = refusal(path);
  if (why) throw new Error(why);
  const icon = iconDataUrl(path);
  if (!icon) throw new Error("That image can't be used as an icon. A PNG must not be interlaced, and other types must be 200 KB or smaller.");
  return icon;
}

/** Your choice as it's kept on the project. A picked image is copied in, a large PNG scaled down. Undefined: back to detecting. */
export function storeIconChoice(projectId: string, choice: ProjectIconChoice): StoredProjectIcon | undefined {
  if (choice.kind === 'auto') return undefined;
  if (choice.kind === 'none') return { kind: 'none' };
  if (choice.kind === 'emoji') return { kind: 'emoji', value: choice.value.trim() };
  const why = refusal(choice.path);
  if (why) throw new Error(why);
  const ext = extname(choice.path).toLowerCase();
  const icon = fitIcon(ext, readFileSync(choice.path));
  if (!icon) throw new Error("That image can't be used as an icon.");
  const dir = iconFolder();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${projectId}${ext}`);
  writeFileSync(target, icon);
  return { kind: 'file', path: target };
}

/** The copy of an image a project no longer uses. */
export function forgetIconFile(stored: StoredProjectIcon | undefined, keep?: StoredProjectIcon) {
  if (stored?.kind !== 'file' || (keep?.kind === 'file' && keep.path === stored.path)) return;
  rmSync(stored.path, { force: true });
}
