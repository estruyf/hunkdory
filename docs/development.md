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

## Releasing

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds, signs and notarizes the app, then attaches the `.dmg` and `.zip` to a GitHub release.

1. Draft a release on GitHub with a tag like `v0.1.0`. The tag sets the app's version, so `app/package.json` doesn't need a bump.
2. Tick **Set as a pre-release** for early versions (`v0.1.0-beta.1`, or any version you don't want to call stable). A release that isn't a pre-release must be tagged on `main`.
3. Publish it. The files are attached once the build and its checks pass. When the release has no notes, GitHub's generated notes are filled in.

To try it without publishing anything, run the workflow by hand (Actions → Release → Run workflow). The signed build is kept as a workflow artifact for a week.

The workflow needs these repository secrets, the same ones Seshboard uses:

| Secret | What it is |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | The Developer ID Application certificate and its private key, exported as `.p12` and base64-encoded |
| `MAC_CERTIFICATE_PASSWORD` | The `.p12`'s password. Only needed if it has one |
| `APPLE_ID` | The Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | The team ID of the certificate |

Without them the run fails: nothing is ever attached unsigned.

## Updating the app icon

`app/resources/icon.svg` is the source. `icon.png` (1024px, transparent outside the tile) and `icon.icns` are generated from it, and the in-app `Logo` in `app/src/renderer/components/ui.tsx` and the menu bar icon in `app/src/main/trayIcon.ts` are drawn by hand to match, so change those too.
