# Hunkdory

Review what your coding agents wrote, one step at a time.

Hunkdory is a local macOS app for reviewing agent branches. Instead of a flat
list of files, it shows the change as a story: what the agent was asked to do,
then chapters in reading order, with the changes nobody explained pulled to the
top. When you're done you merge, send it back to the agent, or discard it.

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
one. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip signing. Notarization is
not set up.
