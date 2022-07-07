/* eslint-disable
  no-console,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call,
  import/no-extraneous-dependencies 
*/

import semver from "semver";

import {assertCommitExistsInBranch} from "./utils.mjs";

// Asserts whether a tag is a valid release candidate or not
// This script is meant to be run by a github workflow
// The output of this script is to either set github variables or not

const tag = process.env.TAG;
const commit = tag;

console.log("Tag:", tag);

// assert it matches proper format vX.X.X-rc.X
const version = semver.parse(tag);
if (!version) {
  console.log("Invalid tag: unparseable version");
  process.exit();
}
if (version.prerelease.length !== 2 && version.prerelease[0] !== "rc" && !Number.isInteger(version.prerelease[1])) {
  console.log("Invalid tag: not a valid rc version");
  process.exit();
}

// assert it exists in branch rc/vX.X.X
const rcBranch = `rc/v${version.major}.${version.minor}.${version.patch}`;
try {
  assertCommitExistsInBranch(commit, rcBranch);
} catch (e) {
  console.log("Invalid commit: does not exist in rc branch", rcBranch);
  process.exit();
}

// success
console.log("::set-output name=is_rc::true");
console.log(`::set-output name=version::${version.version}`);
