#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verify, loadWalkthrough, skeleton, listHunks, UsageError, DEFAULT_WALKTHROUGH } from '../src/verify.mjs';
import { printVerify, printList, toJson } from '../src/report.mjs';

const HELP = `wtv: check an agent's walkthrough against the real diff

Usage
  wtv [verify]   Check every hunk is narrated and every claim is real
  wtv list       Show hunks with their ids (for the agent)
  wtv init       Write a skeleton walkthrough to fill in

Options
  --base <ref>   Base to diff against (default: walkthrough "base", else merge-base with main)
  --head <ref>   Only check committed changes up to <ref> (default: working tree, incl. untracked)
  --file <path>  Walkthrough file (default: ${DEFAULT_WALKTHROUGH})
  --json         Machine-readable output (the UI contract)
  --hook         Claude Code Stop hook mode: exit 2 + reason on stderr when it fails
  --force        Let init overwrite an existing walkthrough
  --cwd <dir>    Repository to work in (default: current folder)

Exit codes
  0 pass · 1 unnarrated hunks or phantom claims · 2 usage error (or hook block)`;

function parseArgs(argv) {
  const opts = { cmd: 'verify' };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) opts.cmd = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--json') opts.json = true;
    else if (a === '--hook') opts.hook = true;
    else if (a === '--force') opts.force = true;
    else if (a === '-h' || a === '--help') opts.cmd = 'help';
    else if (['--base', '--head', '--file', '--cwd'].includes(a)) {
      const v = rest.shift();
      if (!v) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else throw new UsageError(`Unknown option ${a}`);
  }
  return opts;
}

function readHookInput() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const hookInput = opts.hook ? readHookInput() : {};
  const cwd = resolve(opts.cwd ?? hookInput.cwd ?? process.cwd());
  const file = resolve(cwd, opts.file ?? DEFAULT_WALKTHROUGH);

  if (opts.cmd === 'help') {
    console.log(HELP);
    return 0;
  }

  if (opts.cmd === 'list') {
    const r = listHunks({ cwd, base: opts.base, head: opts.head });
    console.log(opts.json ? JSON.stringify(r, null, 2) : printList(r));
    return 0;
  }

  if (opts.cmd === 'init') {
    if (existsSync(file) && !opts.force) throw new UsageError(`${file} already exists. Use --force to overwrite.`);
    const wt = skeleton({ cwd, base: opts.base, head: opts.head });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(wt, null, 2)}\n`);
    console.log(`Wrote ${file} with ${wt.chapters.length} chapter(s). Group, order and explain them.`);
    return 0;
  }

  if (opts.cmd !== 'verify') throw new UsageError(`Unknown command "${opts.cmd}"`);

  if (opts.hook) {
    // Never trap the agent in a loop: one retry, then let it stop.
    if (hookInput.stop_hook_active) return 0;
    if (!existsSync(file)) {
      const { hunks } = listHunks({ cwd, base: opts.base, head: opts.head });
      if (!hunks.length) return 0;
      process.stderr.write(
        `No walkthrough found at ${file}. Before stopping, run "wtv list", then write the walkthrough ` +
          `(intent, chapters in reading order, a "why" per chapter, every hunk referenced) and run "wtv verify".\n`
      );
      return 2;
    }
  }

  const walkthrough = loadWalkthrough(file);
  const r = verify({ cwd, walkthrough, base: opts.base, head: opts.head });

  if (opts.json) {
    console.log(toJson(r));
    return r.ok ? 0 : 1;
  }
  if (opts.hook) {
    if (r.ok) return 0;
    process.stderr.write(`${printVerify(r, { hook: true })}\n`);
    return 2;
  }
  console.log(printVerify(r));
  return r.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`wtv: ${e.message}`);
  } else if (e.stderr) {
    console.error(`wtv: git failed: ${String(e.stderr).trim()}`);
  } else {
    console.error(e);
  }
  // In hook mode a broken tool must never block the agent from stopping.
  process.exitCode = process.argv.includes('--hook') ? 0 : 2;
}
