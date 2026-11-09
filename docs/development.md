# Development

## What's in here

- `app/`: the Electron + React app.
- `tools/wtv/`: the `wtv` CLI that checks an agent's walkthrough against the real diff. The app has the same check built in. See [its README](../tools/wtv/README.md).
- `docs/`: this documentation, the README's screenshots and past plans.

## Run it

```bash
npm install   # installs app/ too
npm run dev
```

Check your work with:

```bash
npm run typecheck
npm test
```

### Try the first-run experience

Point the app at an empty data folder. Your real projects and reviews aren't touched, and an installed copy can stay open:

```bash
REVIEWER_USER_DATA=$(mktemp -d) npm run dev
```

To see it as someone with nothing installed and no session history:

```bash
cd app
npm run build
env HOME=$(mktemp -d) SHELL=/usr/bin/false PATH=/usr/bin:/bin \
  REVIEWER_USER_DATA=$(mktemp -d) \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

Only the app's data is temporary. If you connect a real repo, finishing a review can really merge or post to GitHub. Closing the window leaves the app in the menu bar, so quit it from there.

## Build the Mac app

```bash
npm run pack:mac    # just the .app, in app/dist/mac-arm64/
npm run build:mac   # the .app plus a .dmg and .zip, in app/dist/
npm run open:mac    # open the packaged app
```

The build signs with the Developer ID certificate in your keychain if it finds one. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing. It notarizes when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set.

## Build the Windows app

On Windows 10 or 11, with Node 24 and Git for Windows:

```bash
npm run build:win   # Hunkdory-<version>-setup.exe, its .blockmap and latest.yml, in app/dist/
```

One installer holds both the x64 and the Arm64 app and installs the one that matches the PC; the unpacked apps are in `app/dist/win-unpacked` and `win-arm64-unpacked`. It installs for the current user, without asking for an administrator, in `%LOCALAPPDATA%\Programs\hunkdory`. [`app/scripts/dist-win.mjs`](../app/scripts/dist-win.mjs) runs electron-builder and checks that the build kept Chromium's English locale.

Without signing settings the build is unsigned, and on other PCs SmartScreen stops the installer ("Windows protected your PC": **More info**, then **Run anyway**). To sign locally with Azure Trusted Signing, set the `AZURE_SIGNING_*` variables from [Releasing](#releasing) and sign in to Azure (`az login`, or `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`). A `.pfx` certificate goes in `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

What's different on Windows:

- The environment is the app's own: Windows gives an app started from the Start menu the user's whole environment, so there's no login shell to read. A program installed while Hunkdory runs is found after a restart.
- Only programs (`.exe`) on the PATH count, so Claude Code is the native install (`claude.exe`), not npm's `claude.cmd`: a `.cmd` only starts through cmd.exe, which would read a prompt's quotes and `&` as its own.
- The git guard (`src/main/gitGuard.ts`) is the same `sh` script, run by Git Bash, where Claude Code runs its commands. PowerShell doesn't run it, so Copilot, which runs its commands there, isn't offered on Windows.
- Session folders say `C:\Users\…` while git says `C:/Users/…`, so paths from sessions are read in git's form (`gitPath` in `src/main/paths.ts`).

## Keep the changelog

Every change people will notice gets a line under **Unreleased** in [`CHANGELOG.md`](../CHANGELOG.md), in the same pull request as the change. Group lines under **Added**, **Changed**, **Fixed** or **Removed**, and write them for someone using the app: what they can now do or what no longer goes wrong, not how the code changed. Refactors, tests and internal tooling don't need a line.

## Releasing

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds, signs and notarizes the Mac app and builds and signs the Windows installer. Once both have passed their checks it attaches the `.dmg`, the `.zip`, the `-setup.exe` and the update feeds to a GitHub release, and updates the Homebrew tap.

1. In [`CHANGELOG.md`](../CHANGELOG.md), rename **Unreleased** to the version and date, add a new empty **Unreleased** above it, and update the links at the bottom. Merge that to `main`.
2. Draft a release on GitHub with a tag like `v0.1.0`. The tag sets the app's version, so `app/package.json` doesn't need a bump.
3. Tick **Set as a pre-release** for early versions (`v0.1.0-beta.1`, or any version you don't want to call stable). A release that isn't a pre-release must be tagged on `main`. A pre-release gets no update feed and no cask, so nobody is updated to it.
4. Publish it, leaving the notes empty. The files are attached once the build and its checks pass, and the notes are filled in from the changelog: this version's section, or **Unreleased** for a pre-release. The app shows them under **What's new**. With nothing in the changelog the release gets GitHub's generated notes and the run warns. Every copy of the app offers it within a few hours.

To try it without publishing anything, run the workflow by hand (Actions → Release → Run workflow). The signed builds are kept as workflow artifacts for a week.

To add the Windows installer to a release from before it was built (v0.1.0), run the workflow by hand from `main` with **add_windows_to** set to the release's tag. It builds the installer from `main` as it is now, with that release's version, and attaches it with `latest.yml` (none for a pre-release). The Mac files, the notes and the cask stay as they are.

The workflow needs these repository secrets, the same ones Seshboard uses:

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | The Developer ID Application certificate and its private key, exported as `.p12` and base64-encoded |
| `MAC_CERTIFICATE_PASSWORD` | The `.p12`'s password. Only needed if it has one |
| `APPLE_ID` | The Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | The team ID of the certificate |
| `HOMEBREW_TAP_TOKEN` | A fine-grained token for `estruyf/homebrew-tap` alone, with **Contents: read and write** |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID` | For Windows: the app registration that may sign with Azure Trusted Signing (it has the *Trusted Signing Certificate Profile Signer* role), and the subscription with the Trusted Signing account |

and these repository variables, for Windows signing with Azure Trusted Signing (also Seshboard's):

| Variable | What it is |
| --- | --- |
| `AZURE_SIGNING_ENDPOINT` | The account's endpoint for its region, such as `https://weu.codesigning.azure.net/` |
| `AZURE_SIGNING_ACCOUNT` | The Trusted Signing account's name |
| `AZURE_SIGNING_PROFILE` | The certificate profile's name |
| `AZURE_SIGNING_PUBLISHER` | The publisher in the certificate (its common name), exactly. Installed copies only take updates signed by it, and the run checks the signature against it |

There is no client secret. The Windows job runs in the GitHub environment `windows-signing` and logs in with GitHub's OpenID Connect token, which Azure accepts through a federated credential on the app registration: under Certificates & secrets → Federated credentials, *Other issuer*, issuer `https://token.actions.githubusercontent.com`, subject `repo:estruyf@2900833/hunkdory@1438218663:environment:windows-signing`, audience `api://AzureADTokenExchange`. Seshboard's credential has its own subject, so Hunkdory needs this one too. An `AADSTS700213` error in the Azure login step prints the subject GitHub sent. Instead of Azure, a `.pfx` certificate can go in the secrets `WIN_CERTIFICATE_PFX_BASE64` and `WIN_CERTIFICATE_PASSWORD`.

Without the signing secrets the run fails: nothing is ever attached unsigned. Without the tap token it warns and carries on, so a missing token delays the tap rather than failing a release.

### Updates

The app updates itself with [electron-updater](https://www.electron.build/auto-update) (`src/main/updater.ts`). It checks 15 seconds after launch and every 4 hours, reading `latest-mac.yml` (`latest.yml` on Windows) from the latest GitHub release. A toast offers a new version, downloads it when you say so, and restarts into it. The `.zip` is what a Mac installs and the `-setup.exe` what Windows installs, so every release has to keep them, their `.blockmap` files and the feeds. On Windows it only installs an update signed by the publisher the running app names (`AZURE_SIGNING_PUBLISHER`).

macOS only installs an update signed by the same developer as the running app, so a full run needs two signed builds, like those of two dry runs. Everything up to the restart works without one:

```bash
cd app
node scripts/mock-update-server.ts --fake 9.9.9   # a made-up feed: the toast shows, the download fails
node scripts/mock-update-server.ts --dir <folder> # a real build's latest-mac.yml and .zip
HUNKDORY_MOCK_UPDATES_URL=http://localhost:8484 npm run dev
```

### Homebrew

`brew install --cask estruyf/tap/hunkdory` installs the same signed, notarized `.zip` the release has. The cask is [`homebrew/hunkdory.rb`](../homebrew/hunkdory.rb), and this repository is where it is edited: [`homebrew/publish-cask.sh`](../homebrew/publish-cask.sh) stamps it with a version and a checksum and copies it into [estruyf/homebrew-tap](https://github.com/estruyf/homebrew-tap) on every release. Never edit it in the tap, as the next release overwrites the change.

The cask says `auto_updates true`, so `brew upgrade` leaves the app to its own updater. `depends_on macos:` follows Electron's `LSMinimumSystemVersion`, so move it when an Electron upgrade raises that.

If a release missed the tap, or to see what would land (without `--push` it only prints the cask):

```bash
VERSION=0.1.0 HOMEBREW_TAP_TOKEN=<token> ./homebrew/publish-cask.sh --push
```

## Updating the app icon

`app/resources/icon.svg` is the source. `icon.png` (1024px, transparent outside the tile) and `icon.icns` are generated from it, and the in-app `Logo` in `app/src/renderer/components/ui.tsx` and the menu bar icon in `app/src/main/trayIcon.ts` are drawn by hand to match, so change those too.
