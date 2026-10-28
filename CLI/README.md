# wtv

Check an AI agent's walkthrough against the real diff.

The agent writes `.review/walkthrough.json`: what the change is for, chapters
in reading order, and which hunks each chapter covers. `wtv` diffs your branch
and tells you what the walkthrough **doesn't** explain. That's where the
surprises hide: a constant that quietly changed, a deleted assertion, a debug
file nobody committed.

Zero dependencies. Node 18+ and git.

```
✗ 3 unnarrated hunk(s). The walkthrough doesn't explain these:
  HIGH   src/auth/token.js:1  [Touches auth or security]  h:54b48929c1
      - export const TOKEN_EXPIRY_SECONDS = 3600;
      + export const TOKEN_EXPIRY_SECONDS = 86400;
  HIGH   test/sync.test.js:6  [Lost 1 assertion]  h:f5bee72e04
      -   expect(pushed).toEqual([1, 2]);
         scratch.js:1-2 (untracked)  h:cd6e11d63f
      + import { sync } from './src/sync.js';

✗ 1 phantom claim(s). These refs match nothing in the diff:
  "Retry helper" → src/sync/backoff.js
```

## Commands

```bash
wtv            # verify (default). Exit 0 pass, 1 fail, 2 usage error
wtv list       # every hunk with its id and risk tags
wtv init       # skeleton walkthrough, one chapter per file
```

Options: `--base <ref>`, `--head <ref>` (committed only, good for CI),
`--file <path>`, `--json`, `--hook`, `--cwd <dir>`.

By default it compares the merge-base with `main` to the **working tree**,
including untracked files. The `.review/` folder is never part of the diff.

## How it works

- **Hunks** come from `git diff -U0 -M`. Each gets an id from a hash of its path
  and whitespace-normalised content, so the id survives line shifts and rebases.
  Files without text hunks (binary, rename, mode) get a synthetic hunk so they
  can't slip through.
- **Refs** in a chapter can be `h:<id>`, `path:10-20`, `path` or `folder/`.
- **Buckets**: narrated, unnarrated, noise (whitespace-only), generated
  (lockfiles, dist), phantom (refs matching nothing), weak (high-risk hunk only
  covered by a file or folder ref).
- **Risk tags** are plain heuristics: dependencies, weakened or skipped tests,
  auth and security terms, exec and raw HTML, config and CI, new network calls,
  lint suppressions, swallowed errors, removed exports, TODOs.

## Use it with Claude Code

1. Run `npm link` in this folder so `wtv` is on your path.
2. Copy `skill/` into `.claude/skills/review-walkthrough/` in your repo (or `~/.claude/skills/`).
3. Add a Stop hook to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "wtv verify --hook" }] }
    ]
  }
}
```

When the agent tries to stop with unexplained changes, the hook exits 2 and the
report goes back to the agent. It nudges once per stop (`stop_hook_active`) so it
can't loop, and it never blocks when something goes wrong (no git, no changes).

## JSON contract (for a review UI)

`wtv verify --json` returns `ok`, `intent`, `base`, `head`, `chapters` (with
`hunkIds`), `hunks` (full content, `bucket`, `risks`, `level`, `chapters`),
`buckets` and `findings`. A UI renders chapters in order and puts
`buckets.unnarrated` at the top.

## Known limits

- Two edits on adjacent lines merge into one hunk, which gets a new id. Line
  and file refs still match.
- Risk tags are keyword-based, so expect some false positives (for example
  `session` or `token` in non-auth code).
- Whitespace-only detection is off for indentation-sensitive files (Python, YAML).

## Tests

```bash
npm test            # 9 tests against a generated fixture repo
node test/demo.mjs  # see the report on the "sneaky agent" fixture
```
