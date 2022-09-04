import {execSync} from "node:child_process";

// This file is created in the build step and is distributed through NPM
// MUST be in sync with `-/gitDataPath.ts` and `package.json` files.
import {readGitDataFile, GitData} from "./gitDataPath.js";

/** Reads git data from a persisted file or local git data at build time. */
export function readAndGetGitData(): GitData {
  try {
    // Gets git data containing current branch and commit info from persistent file.
    let persistedGitData: Partial<GitData>;
    try {
      persistedGitData = readGitDataFile();
    } catch (e) {
      persistedGitData = {};
    }

    const currentGitData = getGitData();

    return {
      // If the CLI is run from source, prioritze current git data
      // over `.git-data.json` file, which might be stale here.
      branch:
        currentGitData.branch && currentGitData.branch.length > 0
          ? currentGitData.branch
          : persistedGitData.branch ?? "",
      commit:
        currentGitData.commit && currentGitData.commit.length > 0
          ? currentGitData.commit
          : persistedGitData.commit ?? "",
    };
  } catch (e) {
    return {
      branch: "",
      commit: "",
    };
  }
}

/** Gets git data containing current branch and commit info from CLI. */
export function getGitData(): GitData {
  return {
    branch: process.env.GIT_BRANCH ?? getBranch(),
    commit: process.env.GIT_COMMIT ?? getCommit(),
  };
}

/** Tries to get branch from git CLI. */
function getBranch(): string {
  try {
    return shellSilent("git rev-parse --abbrev-ref HEAD");
  } catch (e) {
    return "";
  }
}

/** Tries to get commit from git from git CLI. */
function getCommit(): string {
  try {
    return shellSilent("git rev-parse --verify HEAD");
  } catch (e) {
    return "";
  }
}

/** Silent shell that won't pollute stdout, or stderr */
function shellSilent(cmd: string): string {
  return execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
    .toString()
    .trim();
}
