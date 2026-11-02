# Hunkdory

Understand what a branch or pull request is about, one step at a time.

Reviewing code you didn't write is hard, and harder when an agent wrote it.
Hunkdory is a local macOS app that tells the change as a story: what was asked,
what the change does in a sentence or two, then chapters in reading order that
each explain one part in plain words. Ask Claude about any step, or have it make
a change. The changes nobody explained are pulled to the top. When you're done
you merge, send it back to the agent, or discard it.

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
- `design/`: the design screens.

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
