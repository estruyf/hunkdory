# Hunkdory: assistants — Claude Code, Copilot, and any ACP agent

Today every walkthrough, question, change and send-back runs through the Claude Code CLI. This plan lets a project choose who does that work:

- **Claude Code**: first-party, the current CLI path. Nothing about how it runs changes.
- **GitHub Copilot**: first-party, through the Copilot CLI, built the same way as Claude Code.
- **Another agent**: any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com) (Gemini, Codex, …), through one ACP client.
- **Manual**: no AI. Hunkdory never sends code anywhere.

## Why Copilot is first-party and not "just ACP"

`copilot --acp --stdio` works. The handshake reports `loadSession`, `session/list` (with each session's `cwd`) and `close`, but no `fork`. The non-interactive CLI is still the better fit, for the same reasons Claude Code runs through its CLI:

- **The CLI enforces the limits.**
  - `--available-tools` decides which tools Copilot can see, and `--allow-tool 'shell(git diff:*)'` decides which run without asking.
  - In `-p` mode anything not allowed is refused, so read-only does not depend on Hunkdory answering permission requests correctly.
- **Isolation flags:**
  - `--no-custom-instructions` (AGENTS.md and friends);
  - `--disable-builtin-mcps`;
  - `--no-ask-user`;
  - `--no-auto-update`.
- **Session control.**
  - `--session-id <uuid>` sets the id of a new session, so Hunkdory knows which sessions are its own and never mistakes them for the agent that made a branch.
  - `--resume <id>` continues one.
- **Copilot-only features ACP can't express:**
  - linking local Copilot sessions to branches;
  - sending a Copilot coding-agent PR back with an `@copilot` comment;
  - per-model premium-request costs.

## Before you start

- Same rules as `docs/plans/2026-10-29-settings-tabs-people.md`:
  - vertical slices;
  - `npm run typecheck` and `npm test` in `app/` after each one;
  - a `.review/walkthrough.json` that passes `wtv verify`;
  - the same "Testing in the real app" steps for slices that change the UI.
- Ask before adding a dependency. That includes `@agentclientprotocol/sdk` in slice 6.
- Real Copilot runs cost premium requests. A handful while building is fine; tests use recorded fixtures.
- Delete any Copilot sessions you create while probing. They live in `~/.copilot/session-state/<id>/`, and you can find them by `cwd` in `workspace.yaml`. Never touch sessions you didn't create.

---

## Slice 1: An `Assistant` interface, with Claude Code behind it

No behaviour change. Today the three call sites build Claude arguments themselves:

- `writer.ts:343`;
- `conversations.ts:221-268`;
- `actions.ts:285-337`.

Move that into `app/src/main/assistants/`:

- `types.ts`: `Assistant` with:
  - `id`, `name` (for UI text: "Ask Copilot");
  - `available()`: is the CLI found, with a reason when it isn't;
  - `run(opts)`: returns a `ClaudeRun`-shaped `{ done, kill }`.

  `opts` holds:
  - `cwd`, `prompt`;
  - `access: 'git-only' | 'read' | 'edit'`;
  - `session: { id, mode: 'copy' | 'continue' } | null`;
  - `schema?` (wanted structured output);
  - `logFile`, `timeoutMs`, `onActivity`.

  Send-back stays detached: give it its own `sendBack(opts)` that returns the pid and the log file.
- `claude.ts`: today's `claudeRun.ts` plus the argument building now spread over the three call sites, including `ISOLATED`, `READ_GIT`, `--fork-session` and the `CLAUDE_CONFIG_DIR` handling.
- `index.ts`: `assistantFor(project)`.

**Done when:** the call sites only talk to `Assistant`; Claude's argument lists are unchanged (add a test that snapshots them per mode); tests pass.

## Slice 2: Choose the assistant per project, and Manual

- `Project.assistant?: 'claude-code' | 'copilot' | 'manual' | \`acp:${string}\``.
  - Unset means `'claude-code'`, so existing projects keep working.
  - `writeWalkthroughs` stays the separate consent to write walkthroughs without asking.
- Connect screen:
  - Add a choice above the walkthrough consent, built from the same radio cards.
  - An option whose CLI isn't installed is disabled and says why.
  - A new project defaults to the first one that's installed: Claude Code, then Copilot, then Manual.
  - The consent block is hidden for Manual.
- `ReviewData` gets `assistant: { id, name } | null`.
  - Replace "Claude" in the ~38 renderer strings that name the assistant ("Ask Claude", "Starting Claude Code…", error messages) with its name.
  - Leave "Claude Code" where it means sessions found on disk.
- Manual:
  - `askAbility` returns `by: null` with a reason, and the Ask box is hidden, not just disabled.
  - Branches without a walkthrough get wtv's skeleton, with no "Write one" button.
  - Send back works only through GitHub (slice 5).

**Done when:** a project can be switched between Claude Code and Manual and behaves accordingly; screenshots of Connect and an Ask step in both modes.

## Slice 3: Copilot fresh runs: walkthroughs, questions, changes

First, two checks. Write down what you find in this file.

1. **The event format.** Run one tiny `copilot -p … --output-format json` and record the event types: the final message, tool calls and their names (`bash` is confirmed; expect something like `view`, `grep`, `glob`, `edit`, `create`), errors. Save it as a fixture under `app/test/fixtures/`.
2. **Repo config.** Make a temp repo with a `.github/hooks/` hook that touches a file, plus a repo-level MCP config. Run Copilot there with the flags below. Does either load?
   - If one does and no flag stops it: refuse to auto-write walkthroughs for a branch that adds or changes those files, and say why.
   - Otherwise: let it run, behind the same consent as today.

Then `assistants/copilot.ts`:

- Base flags:
  - `-p <prompt> --output-format json`;
  - `--no-ask-user --no-custom-instructions --disable-builtin-mcps --no-auto-update`;
  - `--session-id <new uuid> --name "Hunkdory: <what>"`.
- Access:
  - `git-only`: `--available-tools bash` plus `--allow-tool` for each `READ_GIT` command, written as `shell(git diff:*)` and so on.
  - `read`: also the view/grep/glob tools.
  - `edit`: also the edit/create tools and `--allow-tool write`.
- Structured output: there is no `--json-schema`.
  - Ask for the walkthrough as one JSON object.
  - Take the final message, parse it, and check it against `WALKTHROUGH_SCHEMA`.
  - When it fails, run again once with the error in the prompt. The writer already has `attempt` and `feedback`.
- Activity lines: map Copilot's tool names in a `describeTool` of its own.
- Own sessions: keep the ids Hunkdory created in the store. Delete their session-state folders when the run ends, and skip them in slice 4.

**Done when:** on a Copilot project, a walkthrough is written, a question is answered read-only, and a change edits the checkout; event parsing is covered by fixture tests.

## Slice 4: Link and continue Copilot CLI sessions

- `sessions/copilot.ts` reads `~/.copilot/session-state/*/`:
  - `workspace.yaml` for `id`, `cwd`, `name`, `created_at` and `updated_at`;
  - `events.jsonl` for:
    - the first `user.message`, which becomes the prompt;
    - `tool.execution_*`, for test runs and the last edit;
    - `session.start`.
- `SessionInfo` gets `agent: 'claude-code' | 'copilot'`. `configDir` becomes Claude-only.
- Matching is weaker than for Claude, because Copilot doesn't record the git branch:
  - **Strong:** the session's `cwd` is the branch's worktree.
  - **Weaker:** the main folder, when the session was active between the branch's first and last commit and the branch was checked out there (check with the reflog).
  - Show weak matches as "probably", with a way to unlink.
- Continuing a session:
  - Use `copilot --resume <id> -p …` for changes and send-back.
  - Questions use a fresh run, because there's no fork. Its prompt includes the session's first prompt for context.
- `projects.ts:709` and `:813` already label Copilot PRs. Use the same labels for local Copilot sessions.

**Done when:** a branch made by Copilot CLI in a worktree shows its prompt and "GitHub Copilot", and send-back continues that session; matching is unit-tested with fixture session folders.

## Slice 5: Send a Copilot coding-agent PR back on GitHub

- When `pr.copilot` is set, Finish offers "Send back to Copilot", whatever the project's assistant.
- It posts the review comments as a PR review, with a summary comment that mentions `@copilot`, through `gh` (`github.ts` already posts reviews).
- Never post without the user confirming in the Finish dialog, the same as posting a review today.

## Slice 6: Any other agent over ACP

- Ask first: `@agentclientprotocol/sdk`, or a small JSON-RPC-over-stdio client of our own (~150 lines).
- `assistants/acp.ts`:
  - Start the agent, then `initialize`.
    - Offer `fs.readTextFile`. When the branch isn't checked out, serve file reads from `git show <headRef>:<path>`, so questions work without a checkout.
    - Don't offer terminals.
  - `session/new { cwd, mcpServers: [] }`, then `session/prompt`.
  - Map `session/update` tool calls to activity lines, using their `title`.
  - Answer `session/request_permission` with Hunkdory's own rules:
    - read and search are allowed;
    - execute is allowed only for `READ_GIT` commands;
    - edits only for change runs;
    - everything else is rejected.
  - Stop: `session/cancel`, then kill the process.
  - End: `session/close` when the agent offers it.
- Agents are app-level settings, each with a name, command and args. Ship presets:
  - Gemini: `gemini --acp`;
  - Codex: `npx @zed-industries/codex-acp`.

  Add a custom entry. A project picks one as `acp:<id>`.
- Sessions: when the agent offers `session/list`, link by `cwd` the same way as slice 4, and continue with `session/load`.
- Hunkdory can't stop an ACP agent loading the repo's own config, so:
  - Connect says so for ACP agents;
  - auto-writing defaults to off.

**Done when:** Gemini (or a fake ACP agent in tests) writes a walkthrough and answers a question; the permission rules are unit-tested against a scripted fake agent.

## Slice 7: README

- "What you need": Claude Code *or* Copilot CLI *or* an ACP agent, or none at all for Manual.
- "Ask Claude" in "How it works" becomes "ask the assistant".
