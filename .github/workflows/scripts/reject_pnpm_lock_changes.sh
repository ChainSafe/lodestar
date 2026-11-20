#!/usr/bin/env bash
set -euo pipefail

# pnpm-lock.yaml can be easily modified to plant a backdoor. A regular pnpm-lock.yaml diff is never audited.
# Article below details the risks and ease of implementation.
# See https://dev.to/kozlovzxc/injecting-backdoors-to-npm-packages-a0k
#
# This script will exit 1 if pnpm-lock.yaml was modified.
# A Github action should only run this script for non-high trust contributors.
# TODO: Mechanism to allow changes once the pnpm-lock.yaml changes have been audited by the team
# The build job fetches all history so the PR's actual base is available.
MERGE_BASE=$(git merge-base HEAD "refs/remotes/origin/${GITHUB_BASE_REF:?GITHUB_BASE_REF is required}")
CHANGED_FILES=$(git diff --name-only "$MERGE_BASE" HEAD)

if [[ $CHANGED_FILES == *"pnpm-lock.yaml"* ]]; then
  AUTHOR_EMAIL=$(git show -s --format='%ae' HEAD)
  echo "pnpm-lock.yaml modified by external contributor $AUTHOR_EMAIL"
  exit 1
fi
