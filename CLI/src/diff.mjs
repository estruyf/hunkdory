import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function resolveCommit(ref, cwd) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`], cwd).trim();
}

export function defaultBase(cwd) {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      return git(['merge-base', 'HEAD', candidate], cwd).trim();
    } catch {}
  }
  throw new Error('Could not find a base. Pass --base or set "base" in the walkthrough.');
}

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|packages\.lock\.json)$/;
const GENERATED = /(^|\/)(dist|build|out|\.next|coverage|node_modules|vendor)\/|\.min\.(js|css)$|\.map$|\.snap$/;
const INDENT_SENSITIVE = /\.(py|ya?ml|haml|pug|slim|coffee|nim|mk)$|(^|\/)Makefile$/;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const squash = (lines) => lines.join('').replace(/\s+/g, '');

/**
 * Collect hunks between base and head.
 * head === null means "working tree", including untracked files.
 */
export function collectHunks({ base, head, cwd }) {
  // The walkthrough folder is review metadata, never part of the change itself.
  const pathspec = ['--', '.', ':(exclude).review'];
  const args = ['diff', '--no-color', '--no-ext-diff', '-U0', '-M', base];
  if (head) args.push(head);
  const files = parseDiff(git([...args, ...pathspec], cwd));

  if (!head) {
    const untracked = git(['ls-files', '--others', '--exclude-standard', ...pathspec], cwd)
      .split('\n')
      .filter(Boolean);
    for (const path of untracked) files.push(untrackedFile(path, cwd));
  }

  return finalize(files);
}

function untrackedFile(path, cwd) {
  const file = { oldPath: null, newPath: path, status: 'added', untracked: true, binary: false, hunks: [] };
  let buf;
  try {
    buf = readFileSync(join(cwd, path));
  } catch {
    file.binary = true;
    return file;
  }
  if (buf.includes(0)) {
    file.binary = true;
    return file;
  }
  const lines = buf.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  file.hunks.push({ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines.length, context: '', removed: [], added: lines });
  return file;
}

export function parseDiff(raw) {
  const files = [];
  let file = null;
  let hunk = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = { oldPath: m?.[1] ?? null, newPath: m?.[2] ?? null, status: 'modified', binary: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    // Header lines only appear before the first hunk of a file.
    if (!hunk) {
      if (line.startsWith('new file mode')) { file.status = 'added'; continue; }
      if (line.startsWith('deleted file mode')) { file.status = 'deleted'; continue; }
      if (line.startsWith('old mode')) { file.modeChange = true; continue; }
      if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = line.slice(12); continue; }
      if (line.startsWith('rename to ')) { file.newPath = line.slice(10); continue; }
      if (line.startsWith('Binary files ')) { file.binary = true; continue; }
      if (line.startsWith('--- ')) {
        const p = line.slice(4);
        if (p !== '/dev/null') file.oldPath = p.replace(/^a\//, '');
        continue;
      }
      if (line.startsWith('+++ ')) {
        const p = line.slice(4);
        if (p !== '/dev/null') file.newPath = p.replace(/^b\//, '');
        continue;
      }
    }

    const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hm) {
      hunk = {
        oldStart: +hm[1],
        oldCount: hm[2] === undefined ? 1 : +hm[2],
        newStart: +hm[3],
        newCount: hm[4] === undefined ? 1 : +hm[4],
        context: hm[5].trim(),
        removed: [],
        added: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) hunk.added.push(line.slice(1));
    else if (line.startsWith('-')) hunk.removed.push(line.slice(1));
  }
  return files;
}

function finalize(files) {
  const hunks = [];
  const seen = new Map();

  for (const f of files) {
    const path = f.status === 'deleted' ? f.oldPath : f.newPath ?? f.oldPath;
    const kind = f.binary ? 'binary' : null;

    // A file change without text hunks (binary, pure rename, mode change)
    // still gets one synthetic hunk so it can never slip through silently.
    const list = f.hunks.length
      ? f.hunks
      : [{ oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, context: '', removed: [], added: [], synthetic: kind ?? (f.status === 'renamed' ? 'rename' : 'mode') }];

    for (const h of list) {
      const basis = [
        path,
        h.synthetic ?? '',
        f.status === 'renamed' ? `from:${f.oldPath}` : '',
        h.removed.map(norm).join('\n'),
        h.added.map(norm).join('\n'),
      ].join('\0');
      let id = createHash('sha256').update(basis).digest('hex').slice(0, 10);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n > 0) id = `${id}-${n}`;

      const whitespaceOnly =
        !h.synthetic &&
        !INDENT_SENSITIVE.test(path) &&
        (h.added.length > 0 || h.removed.length > 0) &&
        squash(h.added) === squash(h.removed);

      hunks.push({
        id,
        path,
        oldPath: f.oldPath,
        status: f.status,
        untracked: !!f.untracked,
        synthetic: h.synthetic ?? null,
        oldStart: h.oldStart,
        oldCount: h.oldCount,
        newStart: h.newStart,
        newCount: h.newCount,
        context: h.context,
        removed: h.removed,
        added: h.added,
        whitespaceOnly,
        lockfile: LOCKFILES.test(path),
        generated: GENERATED.test(path),
      });
    }
  }
  return hunks;
}

/** Line range a hunk occupies, for matching "path:10-20" refs. */
export function hunkRange(h) {
  if (h.status === 'deleted') return [h.oldStart, h.oldStart + Math.max(h.oldCount, 1) - 1];
  if (h.newCount === 0) return [h.newStart, h.newStart];
  return [h.newStart, h.newStart + h.newCount - 1];
}

export function rangeLabel(h) {
  if (h.synthetic) return h.synthetic;
  const [a, b] = hunkRange(h);
  return a === b ? `${a}` : `${a}-${b}`;
}
