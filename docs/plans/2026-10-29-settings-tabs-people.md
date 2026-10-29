# Hunkdory: settings, inbox tabs, PR people, steady header, projects

Eight slices for the Electron app in `app/`, on branch `claude/reviewer-phase1`.

## Before you start

- **The rename from Reviewer to hunkdory is uncommitted in the working tree.** Build on it. Don't revert it, and don't commit unless you're asked to.
- Work in vertical slices, in the order below. After each one:
  - run `npm run typecheck` and `npm test` in `app/`;
  - write `.review/walkthrough.json` and make `wtv verify` pass (run it from `tools/wtv`, or as `wtv` if it's linked).
- Ask before you add a dependency. You shouldn't need one.
- Match the code around you: inline styles plus the classes in `app/src/renderer/styles.css`, short comments that explain why, and plain user-facing text.

### Testing in the real app

Slices 1, 2, 3 and 6 change what you see, so check them in the running app and take screenshots.

1. Build with `npm run build` in `app/`.
2. Copy `~/Library/Application Support/hunkdory` to a temp folder and delete the `Singleton*` files from the copy. Without that step, the copy hands over to the user's running instance and quits.
3. Run `REVIEWER_USER_DATA=<copy> ./node_modules/.bin/electron . --remote-debugging-port=9444` from `app/`. Port 9333 is taken by Chrome.
4. Drive it over CDP using Node's global `WebSocket`: `Runtime.evaluate` to click, `Page.captureScreenshot` for screenshots.
   - Electron and CDP need the Bash sandbox turned off.
   - Don't put `\n` regexes inside the evaluated template strings.

Rules for the test copy:
- The app stays alive in the menu bar. Kill the test Electron by its pid, and leave the user's own instance alone.
- Never submit Finish in the test copy. It uses the real `gh` and can merge a real PR.
- Never write into `~/.claude/projects`.

---

## Slice 1: Capitalise "Hunkdory" in everything people see

Right now the name is lowercase everywhere. The brand name is **Hunkdory**.

- Change it in user-facing text:
  - `productName` in `app/package.json`;
  - the window title, the `<title>` in `index.html`, the tray tooltip and tray menu ("Open Hunkdory", "Quit Hunkdory");
  - the `Brand` component in `components/ui.tsx`;
  - every sentence in a screen, error message, prompt or GitHub comment that names the app.

  `grep -rn hunkdory app/src app/test` lists them all: about 85 hits in 25 files.
- Keep these lowercase. They are identifiers, and changing them breaks existing data or other people's PR comments:
  - `"name": "hunkdory"` in `package.json`;
  - `REVIEWER_USER_DATA`, `refs/reviewer/pr/<n>`, the `<!-- reviewer:walkthrough -->` marker and `generatedBy.tool: 'reviewer'`;
  - storage keys and file names.
- `productName` also names the data folder. It moves from `.../hunkdory` to `.../Hunkdory`.
  - macOS volumes ignore case by default, so on those it stays the same folder.
  - Check that the move-from-`Reviewer` code in `main/index.ts` still works.
- Update the tests that assert on the old text.

**Done when:** the brand, window title, tray and all visible text say "Hunkdory"; identifiers are unchanged; tests pass.

## Slice 2: The header stays the same height on every screen

The header jumps when you go from the inbox to "Connect a project", and again when you open a review. Each screen builds its own header:
- Home has a 38px search field.
- Connect, PickBranch, StartReview and Finish have one line of breadcrumbs.
- Plan and Walkthrough have breadcrumbs plus a second line, and override the padding (`12px 24px`) and position (`static`).

What to do:
- Give `.topbar` one fixed height, about 64px; check it against the tallest content. Use `flex-wrap: nowrap` and the same padding everywhere.
- Remove the per-screen overrides in `screens/Plan.tsx` and `screens/Walkthrough.tsx`.
- When space runs out, long breadcrumbs (the review title, which has `shrink: true`) get cut off with "…". The header never grows.
- `LoadingPage` in `components/ui.tsx` uses the same header, so the loading state can't jump either.
- Home measures the header with a `ResizeObserver` to make the project list sticky. With a fixed height that can become a CSS variable.
- Newer screenshots show the macOS window buttons (red, yellow, green) inside the header, so the window seems to use a hidden title bar now.
  - If it does, the header needs a fixed space on the left for those buttons, on every screen. Without that, the logo moves from screen to screen.
  - The header also has to be draggable (`-webkit-app-region: drag`), with buttons, fields and links set to `no-drag`.
  - Check which title bar style the window uses before you start.

**Done when:** screenshots at 960px (the minimum window width) and at 1440px show the same header height on Welcome, Home, Connect, PickBranch, StartReview, Plan, Walkthrough, Finish and Done. Clicking between them causes no layout shift.

## Slice 3: A Settings page with a theme and the version

- A gear button at the right of the Home header opens a new route, `{ name: 'settings' }`.
  - It has breadcrumbs (Inbox › Settings), and back/forward work like on every other screen.
  - Reuse the gear icon from `ProjectLink` in `Home.tsx`.
- **Theme:** Light / Dark / System. The default is System.
  - Save the choice in the main process (in the store, or a small settings file next to it), not in `localStorage`.
  - Apply it with `nativeTheme.themeSource` before the window opens, so dark mode never flashes white first.
  - Set `BrowserWindow`'s `backgroundColor` from `nativeTheme.shouldUseDarkColors`.
  - Add the get/set calls to `ReviewerApi` in `shared/types.ts`, to `methods` in `preload/index.ts`, and to `api` in `main/index.ts`.
- **Dark colours:** add a dark set of the CSS variables in `styles.css` under `@media (prefers-color-scheme: dark)`. That media query follows `nativeTheme.themeSource`, so the frame, scrollbars and form controls follow the setting too.
  - Replace the hard-coded colours with variables: about 40 in `styles.css` (diff empty cells, `.diff-bar`, button hover, highlight.js tokens, `mark`) and a few in `diff.tsx`, `search.tsx`, `ui.tsx`, `Connect.tsx` and `Plan.tsx`.
  - Keep the logo's own colours as they are.
  - The highlight.js tokens need dark colours that are still easy to read on the dark diff background.
- **Version:** show "Hunkdory 0.1.0" (from `app.getVersion()`) and the Electron version, with a Copy button for bug reports.

**Done when:** each of the three themes takes effect immediately and survives a restart. Screenshots of Home, Walkthrough (with a diff) and Finish in dark mode look right, and text contrast is at least 4.5:1. Settings shows the version.

## Slice 4: Home as tabs

Home is one long page today: Waiting for you, Sent back to the agent, Reviewed this week, and Ignored (collapsed). Turn those four into tabs with counts:

**Waiting for you (n) · Sent back (n) · Reviewed this week (n) · Ignored (n)**

- Use real tab semantics: `role="tablist"`, `tab` and `tabpanel`, with arrow-key navigation.
- The project list on the left, the search and the project filter apply to every tab. The counts follow the filters.
- The sort order and "Review a branch…" stay with the Waiting tab.
- Home always opens on **Waiting for you**.
  - Exception: if Waiting is empty and another tab isn't, still open on Waiting and show its empty state. Don't jump tabs.
- The empty state text ("Nothing waiting" and the `ScanLine` explanations) stays on the Waiting tab.
- Ignored loses its ▸ toggle; it becomes a tab.

**Done when:** each tab shows only its list; the counts match; search filters within the open tab; the header doesn't move when you switch tabs.

## Slice 5: A link to GitHub from "Reviewed this week"

- When the decision was posted on GitHub, show a "View on GitHub ↗" link on the row. Style it like the `PR #n ↗` pill on inbox cards, and open it with `window.api.openExternal`.
- Which link:
  - use `decision.github.url`, the review comment, when there is one;
  - otherwise use the PR's own URL. `merge` with a COMMENT review can leave the review URL `null`.
- `ReviewState` doesn't keep the PR's URL today. Add `prUrl` to `decision.github` when `record(...)` writes it in `main/actions.ts`.
  - Older records without it simply show no link.
- Local merges and discards get no link.

**Done when:** a review posted on GitHub shows the link and it opens the right page; a local merge shows none; the tests in `app/test` cover the URL fallback.

## Slice 6: Who opened a PR, its reviewers, and a People filter

**Data** (`main/github.ts`, `openPullRequests`):
- Add `assignees`, `reviewRequests` and `latestReviews` to the `gh pr list --json` fields.
- Map them onto `PullRequest`:
  - `assignees: string[]`;
  - `requestedReviewers: string[]` (users by login, teams as `org/team`);
  - `reviews: { login, state }[]`, where `state` is APPROVED, CHANGES_REQUESTED or COMMENTED.
- Pass them through to `InboxItem.pr`, together with `author`, in `main/projects.ts` (where `pr:` is built, around line 703).
- Measure the cost: time `gh pr list` before and after on a real project.
  - For context: in an earlier measurement, `gh pr list` was ~2.9 s of a 4.4–5.4 s inbox load, and checks alone added ~1 s.
  - Report the numbers. If the fields add more than ~0.5 s, say so before going on.
- Add unit tests for the mapping in `app/test/github.test.ts`, with fixtures for team reviewers, bots and an empty `author`.

**Card** (`InboxCard` in `Home.tsx`):
- Under the branch line, PR cards show who's involved, for example:

  `Opened by alice · Review: bob ✓ approved, carol (requested) · Assigned: dave`

  - Use text only, no avatars. The app loads nothing from the network in the window (see the CSP in `index.html`).
  - Leave out empty parts.
  - Show "you" for the signed-in `gh` user. `github.ts` already has a "Who gh is signed in as" helper.

**Local branches** (no PR):
- The filter isn't GitHub-only. A local branch has no assignees or reviewers, but it does have someone who opened it: the author of its newest commit.
  - `main/projects.ts` already reads it with `git log -1 --format=%an` (around line 587). Today it's dropped when the branch matches a Claude Code session (`author: d.match ? null : …`).
  - Keep it on `InboxItem` for every local branch, e.g. as `openedBy: string | null`.
  - For PRs, use the PR's author from GitHub.
- Don't make up assignees or reviewers for local branches. That data only comes from GitHub, and when it does, read it as described above.
- Local cards show only `Opened by <name>`.

**Filter:**
- A "People" `<select>` next to the sort order on the Waiting tab, with an "Anyone" option first and three groups: **Assigned to…**, **Review requested from…** and **Opened by…**.
- Each group lists **Me** first, then everyone found on the inbox items.
- "Me" means:
  - for PRs, the signed-in `gh` login;
  - for local branches, the repo's `git config user.name` (and `user.email`, if commits are matched by email).
- Remember the choice with `usePref`.
- **Opened by…** applies to PRs and local branches alike.
- **Assigned to…** and **Review requested from…** only match PRs, so local branches are hidden while one of those is on. Say so in the empty state, e.g. "Local branches have no assignees."

**Done when:**
- PR cards show author, reviewers and assignees, and local cards show who opened them;
- "Assigned to → Me" shows only PRs assigned to you;
- "Opened by → Me" shows your PRs and your local branches;
- the project counts and tab counts follow the filter;
- the measured `gh` time is reported.

## Slice 7: Rename a project

A project is named after its folder (`basename(path)` in `addProject`, `main/projects.ts`), and you can't change that name. Two repos that are both called `web` look the same in the project list.

- Add a **Name** field at the top of the project's settings page: `Connect.tsx`, opened from the gear next to a project.
  - Also show it when you add a project, filled in with the folder name.
- Add an optional `name` to `ProjectInput` (`shared/types.ts`). `addProject` and `updateProject` save it.
  - Trim it.
  - An empty name falls back to the folder name.
  - Two projects can have the same name. Don't block that, since the path tells them apart.
- Renaming must not lose anything. Reviews, ignored and tracked branches are all keyed by the project's `id`, not its name, so check that this stays true.
- Show the new name everywhere straight away, without waiting for a rescan:
  - the project list and inbox cards (`projectName` on `InboxItem`; the remembered inbox in `components/ui.tsx` still has the old one, so patch or reload it);
  - the breadcrumbs on review screens (`ReviewData.projectName`; `updateProject` already clears that project's cache);
  - "Reviewed this week" (it looks names up from `listProjects`).
- The "Stop watching …?" confirm in `Connect.tsx` uses the new name.

**Done when:**
- renaming a project changes its name in the list, on cards, in the breadcrumbs and in Reviewed this week, without a restart;
- its reviews and ignored branches are still there;
- clearing the field brings back the folder name;
- a test in `app/test` covers saving, trimming and the empty-name fallback.

## Slice 8: Add a project from "Found on this Mac" when you already have projects

The Welcome screen (`screens/Welcome.tsx`) only shows when you have no projects. It lists **Found on this Mac**: repos with recent Claude Code sessions, from `window.api.foundOnThisMac()`, each with an **Add** button.

Once you have one project, "+ Add project" on Home opens `Connect.tsx` ("Connect a project"). That page only has the folder field and "Choose…", so the list of known repos is gone.

- Move the "Found on this Mac" list out of `Welcome.tsx` into a shared component, e.g. `components/found.tsx`. Use it in both places.
  - It takes an `onPick(path)` callback. Welcome keeps going to `{ name: 'connect', path }`.
- On Connect, **when you're adding a new project** (no `projectId`), show the list above "1 Repository".
  - Picking one fills in the folder (`setPath`), which runs the existing folder check. You stay on the page; nothing navigates.
  - Hide the list once a folder is filled in. Clearing the folder brings it back.
  - Don't show it on the settings page of an existing project.
- `foundOnThisMac()` (`main/projects.ts`) already leaves out connected projects, so a repo disappears from the list once you add it.
  - Check that comparison: it compares saved paths with session folders. Paths with a `~` or a trailing slash must still match, or a connected repo shows up again.
- While the list loads, show the existing `Loading` row, so the page doesn't jump when the list arrives. When nothing is found, show one muted line.
- That empty-state text says `~/.claude/projects`, but sessions are also read from `~/.claude-*` config folders. Use "your Claude Code config folders", the same wording as the Claude Code row under "Agent sources".

**Done when:**
- with at least one project, "+ Add project" shows repos found on this Mac;
- picking one fills in the folder and detects the repo, base branch and remote;
- connected repos aren't listed;
- Welcome still works as before;
- a screenshot of Connect with the list is attached.

---

## Decisions (confirmed)

- Settings is a **full page**, not a panel that slides in over the current screen.
- The People filter isn't GitHub-only:
  - **Opened by** works for PRs and for local branches;
  - **assignees** and **requested reviewers** come from GitHub and are read whenever an item is a PR.
- The theme defaults to **System**, and you can set it to **Light** or **Dark** to override it. The choice is kept between launches.
- Home always opens on the **Waiting for you** tab.
