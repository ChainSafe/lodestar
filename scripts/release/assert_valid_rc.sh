#!/bin/bash

# Asserts whether a tag is a valid release candidate or not
# This script is meant to be run by a github workflow
# The output of this script is to either set github variables or not

set -e

COMMIT=$TAG
echo "Tag: $TAG"

# assert it matches proper format vX.X.X-rc.X
RC_REGEX="^v(([0-9]+\.[0-9]+\.[0-9]+)-rc\.[0-9])+$"

if [[ $TAG =~ $RC_REGEX ]]; then
  VERSION=${BASH_REMATCH[1]}
  RC_BRANCH="rc/v${BASH_REMATCH[2]}"
else
  exit
fi

# assert it exists in branch
HEAD_COMMIT=$(git rev-parse refs/remotes/origin/$RC_BRANCH)
git merge-base --is-ancestor $COMMIT $HEAD_COMMIT

# success
echo "is_rc=true" >> $GITHUB_OUTPUT
echo "version=$VERSION" >> $GITHUB_OUTPUT
