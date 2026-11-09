#!/usr/bin/env bash
# A release (not a pre-release) must be built from main, for the jobs in release.yml. Reads TAG and SHA, the commit
# being built.
set -euo pipefail

# "behind" or "identical": the commit is in main's history. Asked of the API, since the checkout is shallow.
status=$(gh api "repos/$GITHUB_REPOSITORY/compare/main...$SHA" --jq .status 2>/dev/null || echo missing)
if [ "$status" != "behind" ] && [ "$status" != "identical" ]; then
  echo "::error::$TAG must come from main, but its commit $SHA is not on main ($status). Tag a commit on main, or publish it as a pre-release."
  exit 1
fi
