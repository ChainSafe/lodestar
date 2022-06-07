/* eslint-disable import/no-extraneous-dependencies */

import semver from "semver";
import {
  assertCommitExistsInBranch,
  assertGitDirectoryIsClean,
  checkBranchExistsLocal,
  checkBranchExistsRemote,
  checkTagExistsLocal,
  checkTagExistsRemote,
  confirm,
  getCommitDetails,
  getCurrentBranch,
  getNextRcTag,
  GIT_REPO_URL,
  parseCmdArgs,
  readMainPackageJson,
  shell,
  syncGitRemote,
  usage,
} from "./utils.mjs";

/* eslint-disable
  no-console,
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call
*/

usage(`
Publish a Lodestar release candidate.

Usage:
  yarn release:tag-rc <version> [commit]

See https://github.com/ChainSafe/lodestar/blob/unstable/RELEASE.md#1-create-release-candidate
`);

// Get command args
// tag_rc <version> [commit]
const {versionMMP, commit} = parseCmdArgs();

const rcBranchName = `rc/v${versionMMP}`;
const tagName = getNextRcTag(versionMMP);

// Asserts script is run in root directory
const mainPackageJson = readMainPackageJson();
const currentVersion = mainPackageJson.version;

// Assert provided version increases latest stable
if (!semver.eq(versionMMP, currentVersion)) {
  throw Error(`Selected version ${versionMMP} is not eq package.json version ${currentVersion}`);
}

// This script must be run from the rc branch
const currentBranch = getCurrentBranch();
if (currentBranch !== rcBranchName) {
  throw Error(`Must be run in branch '${rcBranchName}' but is in '${currentBranch}'`);
}

assertCommitExistsInBranch(commit, rcBranchName);

// sync with remote
syncGitRemote();

// Assert rc branch exists in local and remote
const rcBranchCommitLocal = checkBranchExistsLocal(rcBranchName);
if (rcBranchCommitLocal === null) throw Error(`Branch ${rcBranchName} doesn't exist in local`);
const rcBranchCommitRemote = checkBranchExistsRemote(rcBranchName);
if (rcBranchCommitRemote === null) throw Error(`Branch ${rcBranchName} doesn't exist in remote`);

// Assert tag does not exist in local nor remote
const tagCommitLocal = checkTagExistsLocal(tagName);
if (tagCommitLocal !== null) throw Error(`tag ${tagName} already exists in local`);
const tagCommitRemote = checkTagExistsRemote(tagName);
if (tagCommitRemote !== null) throw Error(`tag ${tagName} already exists in remote`);

// Must ensure git directory is clean before doing any changes.
// Otherwise the lerna version + commit step below could mix in changes by the user.
assertGitDirectoryIsClean();

// Log variables for debug
console.log(`
Tag: ${tagName}
Selected commit: ${commit}

${getCommitDetails(commit)}
`);

if (!(await confirm(`Do you want to publish ${tagName} at commit ${commit}?`))) {
  process.exit(1);
}

// Tag commit as `v1.1.0-rc.0` with an annotated tag, push new tag only
shell(`git checkout ${commit}`);
shell(`git tag -am "${tagName}" ${tagName}`);
shell(`git push ${GIT_REPO_URL} ${tagName}`);
