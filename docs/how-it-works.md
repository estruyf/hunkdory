# How it works under the hood

## What the inbox looks for

Each project is one git repo on your Mac, and its settings say what shows up:

- **Local branches** with commits on top of the project's base branch, or only the ones matching a pattern like `claude/*`.
- **Open pull requests** on GitHub, read through your GitHub CLI sign-in. They're fetched into private refs under `refs/reviewer/`, so your own branches stay as they are.
- **Uncommitted changes** in the repo's folders and worktrees. These are always included.

A branch more than one of them finds shows up once. A new project on GitHub links itself with pull requests on. **Review another branch** opens anything else.

Sessions from Claude Code (`~/.claude` and any `~/.claude-*`) and the Copilot CLI (`~/.copilot`) are matched to branches, which is where the prompt, the agent's reasons and its test runs come from. Reviews work without them, with less context.

## Walkthroughs

A walkthrough is what turns a diff into a story: what the change does, then chapters in reading order, each saying which hunks it covers.

- **The agent's own.** If a branch has a `.review/walkthrough.json`, that's used. See [`wtv`](../tools/wtv/README.md) for the format and an agent skill.
- **Hunkdory's.** Otherwise the project's assistant writes one from the diff, the commits and the agent's session. It's kept in Hunkdory's own folder, not in your repo. Each project chooses whether that happens by itself, and a very large branch always waits for you to ask.
- **A shared one.** A walkthrough posted on a pull request is reused if it still covers the code and comes from you or from the repo's owners, members or collaborators. Anyone else's is ignored, since it's what you'd read instead of the diff.
- **None.** The steps are one per file, without reasons.

Either way, every walkthrough is checked against the real diff. Any hunk it doesn't explain is flagged and pulled up for you to look at, so nothing can be left out of the story. The check is built into the app, and needs only git.

## Assistants

Each project picks who does the work: Claude Code, the Copilot CLI, another agent over the [Agent Client Protocol](https://agentclientprotocol.com), or Manual, which never sends code anywhere.

| | Claude Code and Copilot | ACP agents |
| --- | --- | --- |
| Repo's own settings, hooks and MCP servers | Ignored on runs Hunkdory starts | Hunkdory can't stop an agent loading them |
| Tokens in your shell's startup files | Available, as in a terminal | Only your `PATH`, not your tokens |
| Writing walkthroughs by itself | Your choice per project | Off by default |

ACP support is experimental.

### What an agent may do

- **Questions** are read-only.
- **Changes** edit files where the branch is checked out, and nothing is committed.
- **Send back** resumes the agent's own session, which can edit files on the branch. You can stop it at any time.

Agents only edit from a folder that's on the branch being reviewed. If that folder has moved to another branch since, Hunkdory refuses rather than change the wrong one.

Agents get read-only git commands without asking. Those permissions only look at how a command starts, and some git options can write files or run programs (`git grep -O<program>`, `git diff --output=<file>`), which code under review could try to ask for. So agent runs get a small `git` wrapper first on their `PATH`, which refuses those options. It can't protect against a shell setup that puts another `git` ahead of it.

## Finishing a review

Merging, approving and deleting a branch only go ahead on what you saw. If the branch has new commits or different uncommitted edits since you last looked, nothing happens until you've seen what's new. A local merge merges the exact commit you reviewed.

A pull request isn't merged while some of its work is only on your Mac: GitHub would leave that behind. Push it from the plan first.

Merging or approving with decisions or steps still open takes a second click.

## AI review

A manual second opinion: the project's assistant looks for the kinds of problems the project asks for, such as bugs or accessibility issues, and puts its findings next to the lines. It only runs when you press its button, and its rules live in Hunkdory on your Mac, not in the repo, so a branch can't change the rules of its own review.

## Project icons

A project shows its own icon, found in this order:

1. Declared in the repo: `iconPath` in `.hunkdory.json`, `.seshboard.json` or `t3.json`, or `icon` in `package.json`.
2. Common locations, such as `public/favicon.svg` or `logo.png`, vector images first.
3. The same inside an app folder (`app/`, `web/`, `site/`, `client/`, `frontend/`), then workspace packages (`apps/*`, `packages/*`).

Without one it shows a letter. You can pick an image or an emoji in the project's settings. An icon path can't point outside the repo, including through a symbolic link.

## Where your data lives

Everything is in `~/Library/Application Support/Hunkdory/`:

| Path | What's in it |
| --- | --- |
| `store.json` | Your projects, settings and reviews |
| `walkthroughs/` | The walkthroughs Hunkdory wrote. Settings can delete them |
| `agent-runs/` | Logs of the agent runs it started |
| `project-icons/` | Copies of the images you picked |
| `bin/` | The `git` wrapper for agents |

In your repos, Hunkdory only adds the private refs for pull requests, and a worktree if you check a pull request out from a review. Everything else there is what an agent does when you ask it to, and what you choose to commit or merge.
