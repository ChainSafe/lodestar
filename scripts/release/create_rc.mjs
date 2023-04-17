/* eslint-disable
  no-console,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call,
  import/no-extraneous-dependencies 
*/

import semver from "semver";

import {
  assertCommitExistsInBranch,
  assertGitDirectoryIsClean,
  checkBranchExistsLocal,
  checkBranchExistsRemote,
  confirm,
  getCommitDetails,
  readMainPackageJson,
  parseCmdArgs,
  shell,
  UNSTABLE_BRANCH,
  GIT_REPO_URL,
  REPO_SLUG,
  getCurrentBranch,
  syncGitRemote,
  usage,
  STABLE_BRANCH,
} from "./utils.mjs";

usage(`
Create a Lodestar release candidate.

Usage:
  yarn release:create-rc <version> [commit]

See https://github.com/ChainSafe/lodestar/blob/unstable/RELEASE.md#1-create-release-candidate
`);

// Get command args
// create_rc <version> [commit]
const {versionMMP, commit} = parseCmdArgs();

const rcBranchName = `rc/v${versionMMP}`;
const packageVersion = `${versionMMP}`;

// Asserts script is run in root directory
const mainPackageJson = readMainPackageJson();
const currentVersion = mainPackageJson.version;

// Assert provided version increases latest stable
if (!semver.gt(versionMMP, currentVersion)) {
  throw Error(`Selected version ${versionMMP} is not gt package.json version ${currentVersion}`);
}

const currentBranch = getCurrentBranch();
if (semver.patch(versionMMP) === 0) {
  // New version release candidate
  // This script must be run from unstable or stable branch
  if (currentBranch === STABLE_BRANCH) {
    console.warn(`Warning: Creating a new release from branch ${STABLE_BRANCH}. In most cases, a new release should be based off branch ${UNSTABLE_BRANCH} and only hotfixes should be based off branch ${STABLE_BRANCH}`);
    assertCommitExistsInBranch(commit, STABLE_BRANCH);
  } else if (currentBranch === UNSTABLE_BRANCH) {
    assertCommitExistsInBranch(commit, UNSTABLE_BRANCH);
  } else {
    throw Error(`Must be run in branch '${UNSTABLE_BRANCH}' but is in '${currentBranch}'`);
  }

} else {
  // Hot-fix release candidate
  // This script must be run from unstable branch
  if (currentBranch !== STABLE_BRANCH) {
    throw Error(`Must be run in branch '${STABLE_BRANCH}' but is in '${currentBranch}'`);
  }

  assertCommitExistsInBranch(commit, STABLE_BRANCH);
}

// Sync with remote
syncGitRemote();

// Assert rc branch does not exist in local nor remote
const rcBranchCommitLocal = checkBranchExistsLocal(rcBranchName);
if (rcBranchCommitLocal !== null) throw Error(`Branch ${rcBranchName} already exists in local`);
const rcBranchCommitRemote = checkBranchExistsRemote(rcBranchName);
if (rcBranchCommitRemote !== null) throw Error(`Branch ${rcBranchName} already exists in remote`);

// Must ensure git directory is clean before doing any changes.
// Otherwise the lerna version + commit step below could mix in changes by the user.
assertGitDirectoryIsClean();

// Log variables for debug
console.log(`
Current version: ${currentVersion}
Selected version: ${versionMMP}
RC branch: ${rcBranchName}

Selected commit: ${commit}

${getCommitDetails(commit)}
`);

if (!(await confirm(`Do you want to create a release candidate for ${versionMMP} at commit ${commit}?`))) {
  process.exit(1);
}

// Create a new release branch `rc/v1.1.0` at commit `9fceb02`
shell(`git checkout -b ${rcBranchName} ${commit}`);

// Set monorepo version to `1.1.0`
shell(`lerna version ${packageVersion} --no-git-tag-version --force-publish --yes`);

// Commit changes
shell(`git commit -am "v${versionMMP}"`);

// Push branch, specifying upstream
shell(`git push ${GIT_REPO_URL} ${rcBranchName}`);

// TODO: Open draft PR from `rc/v1.1.0` to `stable` with title `v1.1.0 release`
console.log(`

Pushed ${rcBranchName} to Github, open a release PR:

https://github.com/${REPO_SLUG}/compare/stable...${rcBranchName}

`);
