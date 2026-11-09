#!/usr/bin/env bash
# A release (not a pre-release) must be built from main, for the jobs in release.yml. Reads TAG and SHA, the commit
# being built; ADD_TO when Windows is added to a release that is out, which is built from main as it is now.
set -euo pipefail

if [ -n "${ADD_TO:-}" ] && [ "$GITHUB_REF" != "refs/heads/main" ]; then
  echo "::error::Adding Windows to $TAG builds from main. Run the workflow from main."
  exit 1
fi
# "behind" or "identical": the commit is in main's history. Asked of the API, since the checkout is shallow.
status=$(gh api "repos/$GITHUB_REPOSITORY/compare/main...$SHA" --jq .status 2>/dev/null || echo missing)
if [ "$status" != "behind" ] && [ "$status" != "identical" ]; then
  echo "::error::$TAG must come from main, but its commit $SHA is not on main ($status). Tag a commit on main, or publish it as a pre-release."
  exit 1
fi
