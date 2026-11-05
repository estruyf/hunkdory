# Hunkdory

[![Visitors](https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fgithub.com%2Festruyf%2Fhunkdory&countColor=%233451d1&style=flat)](https://visitorbadge.io/status?path=https%3A%2F%2Fgithub.com%2Festruyf%2Fhunkdory)

Understand what a branch or pull request is about, one step at a time.

Reviewing code you didn't write is hard, and harder when an agent wrote it.
Hunkdory is a local macOS app that tells the change as a story: what was asked,
what the change does in a sentence or two, then chapters in reading order that
each explain one part in plain words. Ask Claude about any step, or have it make
a change. The changes nobody explained are pulled to the top. When you're done
you merge, send it back to the agent, or discard it.

![Hunkdory: a 23-file agent branch told as a story, a question answered by Claude, and a merge](docs/hunkdory.gif)

## How it works

1. **Inbox.** Hunkdory finds the branches your coding agents make in the repos
   you use with Claude Code, open pull requests (Copilot's too), and
   uncommitted changes. New ones show up as they come in.
2. **The plan.** Opening one shows what was asked, what the change does, and
   its steps sorted into three groups: *Decide* (calls only you can make, like
   work you didn't ask for), *Read closely*, and *Skim* (the low-risk rest,
   grouped by folder). A branch without a walkthrough gets one from Claude
   Code, written from the diff, the commits and the agent's session.
3. **The steps.** One step at a time, with the reason next to each change, the
   choices the agent says it made, and how it got there in its session.
   Comment on a line, ask Claude about the step, or ask it to change the code.
   If you want a second opinion first, run an AI review from the plan: the
   project's assistant looks for bugs, accessibility issues and more, and puts
   what it finds next to the lines. Each project sets what it checks.
4. **Finish.** Merge, open a pull request, post your review on GitHub, send it
   back to the agent with your comments, or discard it.

Hunkdory runs on your Mac. It only sends code to Claude when you let it write a
walkthrough, ask a question, run an AI review, or send work back. When the same assistant ran the
agent's session, a walkthrough also gets what the agent said and thought on that
branch, so sharing one on a pull request can carry that reasoning to GitHub.

## What you need

- macOS and git.
- [Claude Code](https://claude.com/claude-code) for walkthroughs, questions and
  sending work back. Reviews still work without it, with less context.
- The [GitHub CLI](https://cli.github.com), signed in with `gh auth login`, for
  pull requests.

## Why "Hunkdory"

"Hunky-dory" means that a situation is very satisfactory, pleasant, or going
well without any problems. The name is a pun on that and on *hunk*, the unit of
a git diff that the whole app is built on. Every hunk the agent touched has to
be explained by its walkthrough, and the ones that aren't are where the
surprises hide. Hunkdory answers one question before you merge: is this branch
really hunky-dory?

## What's in here

- `app/`: the Electron + React app.
- `tools/wtv/`: the `wtv` CLI that checks an agent's walkthrough against the
  real diff. The app uses it as its engine. See [its README](tools/wtv/README.md).

## Run it

```bash
npm install   # installs app/ too
npm run dev
```

## Build the macOS app

```bash
npm run pack:mac    # just the .app, in app/dist/mac-arm64/
npm run build:mac   # the .app plus a .dmg and .zip, in app/dist/
npm run open:mac    # open the packaged app
```

The build signs with the Developer ID certificate in your keychain if it finds
one. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing. It notarizes when
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set.

## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds,
signs and notarizes the app, then attaches the `.dmg` and `.zip` to a GitHub
release.

1. Draft a release on GitHub with a tag like `v0.1.0`. The tag sets the app's
   version, so `app/package.json` doesn't need a bump.
2. Tick **Set as a pre-release** for early versions (`v0.1.0-beta.1`, or any
   version you don't want to call stable). A release that isn't a pre-release
   must be tagged on `main`.
3. Publish it. The files are attached once the build and its checks pass. When
   the release has no notes, GitHub's generated notes are filled in.

To try it without publishing anything, run the workflow by hand (Actions →
Release → Run workflow). The signed build is kept as a workflow artifact for
a week.

The workflow needs these repository secrets, the same ones Seshboard uses:

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | The Developer ID Application certificate and its private key, exported as `.p12` and base64-encoded |
| `MAC_CERTIFICATE_PASSWORD` | The `.p12`'s password |
| `APPLE_ID` | The Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | The team ID of the certificate |

Without them the run fails: nothing is ever attached unsigned.
