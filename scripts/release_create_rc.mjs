/* eslint-disable import/no-extraneous-dependencies */

import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import inquirer from "inquirer";

// TODO: Change to 'unstable'
const UNSTABLE_BRANCH = "dapplion/gitflow";
const GIT_REPO_URL = "git@github.com:ChainSafe/lodestar.git";
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
  const packageVersion = `${versionMMP}-rc.0`;
  const tagName = `v${packageVersion}`;

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

  ensureCommitExistsInBranch(commit, UNSTABLE_BRANCH);

  // Assert rc branch does not exist in local nor remote
  const rcBranchCommitLocal = checkBranchExistsLocal(rcBranchName);
  if (rcBranchCommitLocal !== null) throw Error(`RC branch ${rcBranchName} already exists in local`);
  const rcBranchCommitRemote = checkBranchExistsRemote(rcBranchName);
  if (rcBranchCommitRemote !== null) throw Error(`RC branch ${rcBranchName} already exists in remote`);

  // Assert tag does not exist in local nor remote
  const tagCommitLocal = checkTagExistsLocal(tagName);
  if (tagCommitLocal !== null) throw Error(`tag ${tagName} already exists in local`);
  const tagCommitRemote = checkTagExistsRemote(tagName);
  if (tagCommitRemote !== null) throw Error(`tag ${tagName} already exists in remote`);

  // Log variables for debug
  console.log(`
  User provided version: ${versionMMP}
  User provided commit: ${commit}
  Current version: ${currentVersion}
  RC branch: ${rcBranchName}
  Package version: ${packageVersion}
  Tag: ${tagName}
  `);

  await confirm("This action will commit and push to remote repo");

  // Create a new release branch `rc/v1.1.0` at commit `9fceb02`
  shell(`git checkout -b ${rcBranchName} ${commit}`);

  // Set monorepo version to `1.1.0-rc.0`
  shell(`lerna version ${packageVersion} --no-git-tag-version --force-publish --yes`);

  // Commit changes
  shell(`git commit -am "${tagName}"`);

  // Tag resulting commit as `v1.1.0-rc.0` with an annotated tag, push branch and tag
  shell(`git tag -am "${tagName}" ${tagName}`);
  shell("git push --tag");

  // Open draft PR from `rc/v1.1.0` to `stable` with title `v1.1.0 release`
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
function ensureCommitExistsInBranch(commit, branch) {
  // Ensure the branch exists
  try {
    shell(`git show-branch --no-name ${branch}`);
  } catch (e) {
    throw Error(`Branch ${branch} does not exist: ${e.message}`);
  }

  // Ensure the commit exists in the branch's last 100 commits
  const last10Commits = shell(`git --no-pager log --oneline -n 100 --pretty=format:"%h" ${branch}`);
  const commitMatch = last10Commits.match(commit);
  if (commitMatch == null) {
    throw Error(`Commit ${commit} does not belong to branch ${branch}`);
  }
}

/**
 * Generic confirm prompt
 * @param {string} message
 */
async function confirm(message) {
  // CI is never interactive, skip checks
  if (process.CI) {
    return;
  }

  const input = await inquirer.prompt([
    {
      name: "yes",
      type: "confirm",
      message: `Do you want to proceed? ${message}`,
    },
  ]);
  if (!input.yes) {
    process.exit(1);
  }
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
