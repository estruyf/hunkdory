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
     "intent": "One sentence: what this change is for",
     "base": "<base commit from wtv list>",
     "head": "<current HEAD sha>",
     "chapters": [
       {
         "title": "Short name of one idea",
         "why": "Why this was needed, in one or two sentences",
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
- Whitespace-only and lockfile hunks are skipped automatically. You don't need
  to narrate them.
