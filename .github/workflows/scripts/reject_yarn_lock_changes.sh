# yarn.lock can be easily modified to plant a backdoor. A regular yarn.lock diff is never audited.
# Article below details the risks and ease of implementation.
# See https://dev.to/kozlovzxc/injecting-backdoors-to-npm-packages-a0k
#
# This script will exit 1 if yarn.lock was modified.
# A Github action should only run this script for non-high trust contributors.
# TODO: Mechanism to allow changes once the yarn.lock changes have been audited by the team


# From https://stackoverflow.com/questions/10641361/get-all-files-that-have-been-modified-in-git-branch
MERGE_BASE=$(git merge-base $GITHUB_REF unstable)
CHANGED_FILES=$(git diff --name-only $GITHUB_REF $MERGE_BASE)


if [[ $CHANGED_FILES == *"yarn.lock"* ]]; then
  AUTHOR_EMAIL=$(git show -s --format='%ae' $GITHUB_REF)
  echo "yarn.lock modified by external contributor $AUTHOR_EMAIL"
  exit 1
fi
