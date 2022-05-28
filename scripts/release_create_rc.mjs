/* eslint-disable import/no-extraneous-dependencies */

import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import inquirer from "inquirer";

const UNSTABLE_BRANCH = "unstable";
const REPO_SLUG = "chainsafe/lodestar";
const GIT_REPO_URL = `git@github.com:${REPO_SLUG}.git`;
const MAIN_PACKAGE_PATH = "packages/lodestar";

/* eslint-disable
  no-console,
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call
*/

// Scope to prevent variable conflicts with functions below
{
  // Get command args
  // release_create_candidate <version> [commit]

  const {versionMMP, commit} = parseCmdArgs();

  // TODO: Generalize to bump rc.0 to rc.1
  const rcBranchName = `rc/v${versionMMP}`;
  const packageVersion = `${versionMMP}`;
  const tagName = `v${packageVersion}-rc.0`;

  // Asserts script is run in root directory
  const mainPackageJson = readMainPackageJson();
  const currentVersion = mainPackageJson.version;

  // Assert provided version increases latest stable
  // Note - temp: Allows equal to unblock first release after previous strategy, which bumped unstable preemptively
  if (!semver.gte(versionMMP, currentVersion)) {
    throw Error(`Provided version ${versionMMP} is not gte current version ${currentVersion}`);
  }

  // This script must be run from unstable branch
  const currentBranch = shell("git rev-parse --abbrev-ref HEAD");
  if (currentBranch !== UNSTABLE_BRANCH) {
    throw Error(`Must be run in branch '${UNSTABLE_BRANCH}' but is in '${currentBranch}'`);
  }

  assertCommitExistsInBranch(commit, UNSTABLE_BRANCH);

  // Assert rc branch does not exist in local nor remote
  const rcBranchCommitLocal = checkBranchExistsLocal(rcBranchName);
  if (rcBranchCommitLocal !== null) throw Error(`RC branch ${rcBranchName} already exists in local`);
  const rcBranchCommitRemote = checkBranchExistsRemote(rcBranchName);
  if (rcBranchCommitRemote !== null) throw Error(`RC branch ${rcBranchName} already exists in remote`);

  // Must ensure git directory is clean before doing any changes.
  // Otherwise the lerna version + commit step below could mix in changes by the user.
  assertGitDirectoryIsClean();

  // Log variables for debug
  console.log(`
Selected version: ${versionMMP}
RC branch: ${rcBranchName}
Current version: ${currentVersion}

Selected commit: ${commit}

${getCommitDetails(commit)}
  `);

  if (!(await confirm(`Do you want to start a release process for ${versionMMP} at commit ${commit}?`))) {
    process.exit(1);
  }

  // Create a new release branch `rc/v1.1.0` at commit `9fceb02`
  shell(`git checkout -b ${rcBranchName} ${commit}`);

  // Set monorepo version to `1.1.0-rc.0`
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

  if (await confirm(`Do you want to create and publish a release candidate ${tagName}?`)) {
    // Assert tag does not exist in local nor remote
    const tagCommitLocal = checkTagExistsLocal(tagName);
    if (tagCommitLocal !== null) throw Error(`tag ${tagName} already exists in local`);
    const tagCommitRemote = checkTagExistsRemote(tagName);
    if (tagCommitRemote !== null) throw Error(`tag ${tagName} already exists in remote`);

    // Tag resulting commit as `v1.1.0-rc.0` with an annotated tag, push new tag only
    shell(`git tag -am "${tagName}" ${tagName}`);
    shell(`git push ${GIT_REPO_URL} ${tagName}`);
  }
}

/////////////////////////////

/**
 * @param {string} cmd
 * @returns {string}
 */
function shell(cmd) {
  return child_process.execSync(cmd, {encoding: "utf8", stdio: "pipe"}).trim();
}

/**
 * ```
 * release_create_candidate <version> <commit>
 * ```
 * @typedef {Object} CliArgs
 * @property {string} versionMMP - Major,Minor,Patch semver version to be released '0.37.0'
 * @property {string} commit - Commit hash to be released (optional)
 * @returns {CliArgs}
 */
function parseCmdArgs() {
  const versionArg = process.argv[2];
  const commitArg = process.argv[3]; // Optional

  if (versionArg === undefined) {
    throw Error("argv[2] undefined, must provide version");
  }

  if (commitArg === undefined) {
    throw Error("argv[3] undefined, must provide commit");
  }

  const versionObj = semver.parse(versionArg);

  // Re-format version to drop any prefixes or suffixes
  const versionMMP = [versionObj.major, versionObj.minor, versionObj.patch].join(".");

  try {
    if (versionObj.includePrerelease) throw Error("Includes pre-release");
    if (semver.clean(versionArg) !== versionMMP) throw Error("No clean major.minor.path version");
  } catch (e) {
    throw Error(`Bad argv[2] semver version '${versionArg}': ${e.message}`);
  }

  return {
    versionMMP,
    commit: commitArg,
  };
}

/**
 * @param {string} commit
 * @param {string} branch
 */
function assertCommitExistsInBranch(commit, branch) {
  /** @type {string} */
  let headCommit;
  try {
    // Also, ensure the branch exists first
    headCommit = shell(`git rev-parse refs/heads/${branch}`);
  } catch (e) {
    throw Error(`Branch ${branch} does not exist: ${e.message}`);
  }

  // Best, safest strategy to assert ancestor-ship
  // From https://stackoverflow.com/questions/43535132/given-a-commit-id-how-to-determine-if-current-branch-contains-the-commit
  //
  // git merge-base --is-ancestor parent child -> exit code 0 (YES)
  // git merge-base --is-ancestor child parent -> exit code 1 (NO)
  // git merge-base --is-ancestor child child  -> exit code 0 (YES)

  try {
    shell(`git merge-base --is-ancestor ${commit} ${headCommit}`);
  } catch (e) {
    throw Error(`Commit ${commit} does not belong to branch ${branch}`);
  }
}

/**
 * Generic confirm prompt
 * @param {string} message
 */
async function confirm(message) {
  // CI is never interactive, skip checks
  if (process.env.CI) {
    return true;
  }

  const input = await inquirer.prompt([
    {
      name: "yes",
      type: "confirm",
      message,
    },
  ]);

  return Boolean(input.yes);
}

/**
 * Returns branch head commit if exists, null if doesn't exists
 * @param {string} branch
 * @returns {string|null}
 */
function checkBranchExistsLocal(branch) {
  try {
    return shell(`git show-ref refs/heads/${branch}`);
  } catch (e) {
    return null;
  }
}

/**
 * Returns branch head commit if exists, null if doesn't exists
 * @param {string} branch
 * @returns {string|null}
 */
function checkBranchExistsRemote(branch) {
  // From https://stackoverflow.com/questions/8223906/how-to-check-if-remote-branch-exists-on-a-given-remote-repository

  // If branch is found returns:
  // ```
  // b523c9000c4df1afbd8371324083fef218669108        refs/heads/branch-name
  // ```
  // If not found, returns empty
  try {
    console.log(`Checking if branch ${branch} exists in remote`); // Log as this action is slow
    const out = shell(`git ls-remote --heads ${GIT_REPO_URL} refs/heads/${branch}`);

    // Empty means not found
    if (!out) return null;

    // Return the first part of the first line
    return out.split(/\s+/)[0];
  } catch (e) {
    return null;
  }
}

/**
 * Returns tag commit if exists, null if doesn't exists
 * @param {string} tag
 * @returns {string|null}
 */
function checkTagExistsLocal(tag) {
  try {
    return shell(`git show-ref refs/tags/${tag}`);
  } catch (e) {
    return null;
  }
}

/**
 * Returns tag commit if exists, null if doesn't exists
 * @param {string} tag
 * @returns {string|null}
 */
function checkTagExistsRemote(tag) {
  // Returns list of tags
  // bb944682f7f65272137de74ed18605e49257356c    refs/tags/v0.1.6
  // 771a930dc0ba86769d6862bc4dc100acc50170fa    refs/tags/v0.1.6^{}
  //
  // What's the '^{}'? Explanation below:
  // https://stackoverflow.com/questions/15472107/when-listing-git-ls-remote-why-theres-after-the-tag-name
  try {
    console.log(`Checking if tag ${tag} exists in remote`); // Log as this action is slow
    const out = shell(`git ls-remote --tags ${GIT_REPO_URL} refs/tags/${tag}`);

    // Empty means not found
    if (!out) return null;

    // Return the first part of the first line
    return out.split(/\s+/)[0];
  } catch (e) {
    return null;
  }
}

/**
 * Throws if there are any tracked or untracked changes
 */
function assertGitDirectoryIsClean() {
  // From https://unix.stackexchange.com/questions/155046/determine-if-git-working-directory-is-clean-from-a-script
  const changedFileList = shell("git status --porcelain");
  if (changedFileList) {
    throw Error(`git directory must be clean, changed files:\n${changedFileList}`);
  }
}

/**
 * Returns the package.json JSON of the main package (lodestar)
 * @typedef {Object} PackageJson
 * @property {string} version - Clean semver version '0.37.0'
 * @returns {PackageJson}
 */
function readMainPackageJson() {
  const packageJsonPath = path.join(MAIN_PACKAGE_PATH, "package.json");

  /** @type {string} */
  let jsonStr;
  try {
    jsonStr = fs.readFileSync(packageJsonPath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw Error(`Must run script from repo root dir, package.json not found at ${packageJsonPath}`);
    } else {
      throw e;
    }
  }

  /** @type {PackageJson} */
  const json = JSON.parse(jsonStr);
  if (!json.version) throw Error(`Empty .version in ${packageJsonPath}`);

  return json;
}

/**
 * Returns formated details about the commit
 * @param {string} commit
 * @returns {string}
 */
function getCommitDetails(commit) {
  // commit <hash>
  // Author: <author>
  // Date:   <author-date>
  //
  // <title-line>
  //
  // <full-commit-message>
  return shell(`git log -n 1 ${commit} --date=relative --pretty=medium`);
}
