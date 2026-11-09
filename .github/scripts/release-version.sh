#!/usr/bin/env bash
# The version a release build gets, from the release's tag, for the jobs in release.yml. Writes VERSION, and PRERELEASE
# (true or false), to $GITHUB_ENV.
#
# Reads TAG and DRY_RUN; PRERELEASE for a published release; ADD_TO when Windows is added to a release that is already
# out (it is then looked up here, so the release must exist and be published).
# A dry run gets a suffix no release carries (0.1.0-dryrun.42), so its build is never mistaken for a release.
set -euo pipefail

if [ "$DRY_RUN" == "true" ]; then
  version="$(node -p "require('./app/package.json').version")-dryrun.$GITHUB_RUN_NUMBER"
  echo "::notice::Dry run: building $version. Nothing is published."
  PRERELEASE=true
else
  if [ -n "${ADD_TO:-}" ]; then
    if ! info=$(gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease --jq '"\(.isDraft) \(.isPrerelease)"'); then
      echo "::error::There is no release $TAG to add Windows to."
      exit 1
    fi
    read -r draft PRERELEASE <<< "$info"
    if [ "$draft" == "true" ]; then
      echo "::error::$TAG is a draft. Publish it instead: that builds Windows along with everything else."
      exit 1
    fi
  fi
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
