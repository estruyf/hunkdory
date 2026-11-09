#!/usr/bin/env bash
# The version a release build gets, from the release's tag, for the jobs in release.yml. Writes VERSION, and PRERELEASE
# (true or false), to $GITHUB_ENV.
#
# Reads TAG, DRY_RUN and PRERELEASE.
# A dry run gets a suffix no release carries (0.1.0-dryrun.42), so its build is never mistaken for a release.
set -euo pipefail

if [ "$DRY_RUN" == "true" ]; then
  version="$(node -p "require('./app/package.json').version")-dryrun.$GITHUB_RUN_NUMBER"
  echo "::notice::Dry run: building $version. Nothing is published."
  PRERELEASE=true
else
  version="${TAG#v}"
  if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "::error::The release tag '$TAG' is not a version like v1.2.3."
    exit 1
  fi
  if [[ "$version" == *-* ]] && [ "${PRERELEASE:-}" != "true" ]; then
    echo "::error::$TAG has a pre-release version; publish it as a pre-release."
    exit 1
  fi
fi
echo "VERSION=$version" >> "$GITHUB_ENV"
echo "PRERELEASE=${PRERELEASE:-false}" >> "$GITHUB_ENV"
