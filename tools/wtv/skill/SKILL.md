---
name: review-walkthrough
description: Write a review walkthrough (.review/walkthrough.json) for the code you changed, then check it with wtv. Use at the end of any coding task in a git repo, before you say you are done, or when the wtv Stop hook asks for it.
---

# Review walkthrough

The person reviewing your work reads it in the order you give, and trusts that
nothing changed outside what you describe. `wtv` checks that claim against the
real diff. Your job is to make the walkthrough complete and honest.

## Steps

1. Run `wtv list`. It prints every hunk you changed with an id like `h:54b48929c1`,
   plus risk tags. Untracked files are included.
2. Write `.review/walkthrough.json`:

   ```json
   {
     "version": 1,
     "intent": "In plain words: what this change does and why",
     "base": "<base commit from wtv list>",
     "head": "<current HEAD sha>",
     "chapters": [
       {
         "title": "Short name of one idea",
         "why": "What this part does and why it was needed, in one or two short sentences",
         "risk": "Optional: what could break, what to check",
         "checks": ["Optional: questions the reviewer should answer, one per item"],
         "hunks": ["h:54b48929c1", "src/retry.js", "src/sync.js:10-24"],
         "notes": { "h:54b48929c1": "Optional: a note on one hunk, e.g. a choice you made" }
       },
       {
         "title": "Something you changed that the task didn't ask for",
         "why": "Why you did it anyway",
         "outsideTask": true,
         "hunks": ["h:cd6e11d63f"]
       }
     ]
   }
   ```

3. Run `wtv verify`. Repeat until it says PASS.

## Rules

- **Write for someone new to this code.** The reviewer didn't write it and may
  not know this part of the codebase. Use plain words and short sentences. Say
  what a change does for the app or its users before how the code does it, and
  explain a project-specific name the first time you use it. Explain the idea;
  don't list every identifier or file you touched, the hunks show those.
- **`intent` is what the reviewer reads first.** One or two short sentences on
  what the change does and why, not a list of everything in it.
- **Every hunk belongs to a chapter.** Including the small, incidental ones:
  a changed constant, a removed assertion, a debug file, a config tweak. These
  are exactly what reviewers miss. If a change was not intended, revert it
  instead of narrating it.
- **Order chapters for reading**, not by file. Start where behaviour enters
  (entry point, public function, route), then follow the data. Tests go in the
  chapter of the code they test.
- **Prefer `h:<id>` refs**, then `path:start-end`. Use a whole-file ref only for
  new files. Never use folder refs. Risky hunks covered only by a file ref get flagged.
- **One idea per chapter.** If a chapter's "why" needs "and also", split it.
- **Fill `risk`** for anything tagged high in `wtv list`: say what you changed
  and what the reviewer should check.
- **Write `checks`** as short questions the reviewer should answer, especially
  for assumptions you made ("Is falling back to the client IP what you want?").
- **Mark `outsideTask: true`** on a chapter for anything the prompt didn't ask
  for: drive-by refactors, formatting, unrelated fixes. Better: revert them.
- **Use `notes`** for a hunk where you made a choice the reviewer should know
  about. Key it by one of the chapter's refs. A note on a hunk the chapter
  doesn't cover is reported.
- **Don't reference things that aren't in the diff.** Refs that match nothing
  fail the check as phantom claims.
- **Help the reviewer understand it, where you can.** All optional, and a missing
  field is better than a wrong one:
  - `background`: how this part of the code works today, in two or three sentences.
  - `behaviour` on a chapter: `{ "before", "after", "example" }`, when it changes
    what the app or a caller does.
  - `dependents` on a chapter: up to 5 `{ "path", "what" }`, files outside the diff
    that use what it changes.
  - `requested`: each thing the prompt asked for, as
    `{ "item", "status": "done" | "partly" | "missing", "chapters": ["Title"], "note" }`.
  - `tryIt`: up to 5 `{ "do", "expect" }`, using commands that exist in the repo.
  - `diagram`, when the change crosses at least three parts of the code: 3 to 8
    `nodes` (`{ "id", "label", "kind", "files", "unchanged" }`) and `edges`
    (`{ "from", "to", "label" }`). Boxes whose files contradict the diff are dropped.
- Whitespace-only and lockfile hunks are skipped automatically. You don't need
  to narrate them.
