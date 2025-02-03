/* eslint-disable
  no-console,
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-return,
  @typescript-eslint/explicit-module-boundary-types,
  import/no-extraneous-dependencies
*/

import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import inquirer from "inquirer";

export const UNSTABLE_BRANCH = "unstable";
export const STABLE_BRANCH = "stable";
export const REPO_SLUG = "chainsafe/lodestar";
export const GIT_REPO_URL = `git@github.com:${REPO_SLUG}.git`;
export const MAIN_PACKAGE_PATH = "packages/cli";

/**
 * @param {string} cmd
 * @returns {string}
 */
export function shell(cmd) {
  return child_process.execSync(cmd, {encoding: "utf8", stdio: "pipe"}).trim();
}

/**
 * ```
 * cmd <version> [commit]
 * ```
 * @typedef {Object} CliArgs
 * @property {string} versionMMP - Major.Minor.Patch semver version to be released, eg: '1.1.0'
 * @property {string} commit - Commit hash to be released (optional)
 * @returns {CliArgs}
 */
export function parseCmdArgs() {
  const versionArg = process.argv[2];
  const commitArg = process.argv[3];

  if (versionArg === undefined) {
    throw Error("argv[2] undefined, must provide version");
  }

  let commit;
  // optional arg, defaults to HEAD
  try {
    commit = shell(`git log -n 1 --pretty='%h' ${commitArg ?? "HEAD"}`);
  } catch (_e) {
    throw Error(`Invalid commit ${commitArg}`);
  }

  const versionObj = semver.parse(versionArg);

  // Re-format version to drop any prefixes or suffixes
  const versionMMP = [versionObj.major, versionObj.minor, versionObj.patch].join(".");

  try {
    if (versionObj.includePrerelease) throw Error("Includes pre-release");
    if (semver.clean(versionArg) !== versionMMP) throw Error("No clean major.minor.path version");
  } catch (_e) {
    throw Error(`Bad argv[2] semver version '${versionArg}': ${e.message}`);
  }

  return {
    versionMMP,
    commit,
  };
}

/**
 * @param {string} commit
 * @param {string} branch
 */
export function assertCommitExistsInBranch(commit, branch) {
  /** @type {string} */
  let headCommit;
  try {
    // Also, ensure the branch exists first
    headCommit = shell(`git rev-parse refs/heads/${branch}`);
  } catch (_e) {
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
  } catch (_e) {
    throw Error(`Commit ${commit} does not belong to branch ${branch}`);
  }
}

/**
 * Generic confirm prompt
 * @param {string} message
 */
export async function confirm(message) {
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
export function checkBranchExistsLocal(branch) {
  try {
    return shell(`git show-ref refs/heads/${branch}`);
  } catch (_e) {
    return null;
  }
}

/**
 * Returns branch head commit if exists, null if doesn't exists
 * @param {string} branch
 * @returns {string|null}
 */
export function checkBranchExistsRemote(branch) {
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
  } catch (_e) {
    return null;
  }
}

/**
 * Returns tag commit if exists, null if doesn't exists
 * @param {string} tag
 * @returns {string|null}
 */
export function checkTagExistsLocal(tag) {
  try {
    return shell(`git show-ref refs/tags/${tag}`);
  } catch (_e) {
    return null;
  }
}

/**
 * Returns tag commit if exists, null if doesn't exists
 * @param {string} tag
 * @returns {string|null}
 */
export function checkTagExistsRemote(tag) {
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
  } catch (_e) {
    return null;
  }
}

/**
 * Throws if there are any tracked or untracked changes
 */
export function assertGitDirectoryIsClean() {
  // From https://unix.stackexchange.com/questions/155046/determine-if-git-working-directory-is-clean-from-a-script
  const changedFileList = shell("git status --porcelain");
  if (changedFileList) {
    throw Error(`git directory must be clean, changed files:\n${changedFileList}`);
  }
}

/**
 * Returns the package.json JSON of the main package (lodestar-cli)
 * @typedef {Object} PackageJson
 * @property {string} version - Clean semver version '1.1.0'
 * @returns {PackageJson}
 */
export function readMainPackageJson() {
  const packageJsonPath = path.join(MAIN_PACKAGE_PATH, "package.json");

  /** @type {string} */
  let jsonStr;
  try {
    jsonStr = fs.readFileSync(packageJsonPath, "utf8");
  } catch (_e) {
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
export function getCommitDetails(commit) {
  // commit <hash>
  // Author: <author>
  // Date:   <author-date>
  //
  // <title-line>
  //
  // <full-commit-message>
  return shell(`git log -n 1 ${commit} --date=relative --pretty=medium`);
}

/**
 * Return the currently checked-out branch
 * @returns {string}
 */
export function getCurrentBranch() {
  return shell("git rev-parse --abbrev-ref HEAD");
}

/**
 * Sync remote branches and tags
 * @returns {void}
 */
export function syncGitRemote() {
  shell("git fetch -pt");
}

/**
 * Print usage and exit if no args or --help is provided
 */
export function usage(helpText) {
  if (process.argv.includes("--help") || process.argv.includes("-h") || !process.argv[2]) {
    console.log(helpText);
    process.exit(1);
  }
}

/**
 * Compares tags to find the next, yet unpublished, rc tag
 * @param {string} version clean major.minor.patch version
 * @returns {string}
 */
export function getNextRcTag(version) {
  const latestRc = shell(`git tag -l v${version}-rc.*`).split("\n").sort(semver.rcompare)[0];
  if (latestRc) {
    return `v${semver.inc(latestRc, "prerelease")}`;
  }
  return `v${version}-rc.0`;
}
