import {execSync} from "child_process";

/**
 * Persist git data and distribute through NPM so CLI consumers can know exactly
 * at what commit was this src build. This is used in the metrics and to log initially.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
type GitData = {
  /** "0.28.2-alpha" */
  semver: string;
  /** "developer/feature-1" */
  branch: string;
  /** "80c248bb392f512cc115d95059e22239a17bbd7d" */
  commit: string;
  /** "0.28.2-alpha+7(80c248bb)" */
  version: string;
};

/** Silent shell that won't pollute stdout, or stderr */
function shell(cmd: string): string {
  return execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
    .toString()
    .trim();
}

/** Tries to get branch from git. */
function getBranch(): string | undefined {
  try {
    return shell("git rev-parse --abbrev-ref HEAD");
  } catch (e) {
    return undefined;
  }
}

/** Tries to get commit from git. */
function getCommit(): string | undefined {
  try {
    return shell("git rev-parse --verify HEAD");
  } catch (e) {
    return undefined;
  }
}

/** Tries to get the latest tag. */
function getLatestTag(): string | undefined {
  try {
    return shell("git describe --abbrev=0");
  } catch (e) {
    return undefined;
  }
}

/** Gets number of commits since latest tag/release. */
function getCommitsSinceRelease(): number | undefined {
  let numCommits = 0;
  let latestTag = getLatestTag();
  try {
    numCommits = +shell(`git rev-list ${latestTag}..HEAD --count`);
  } catch (e) {
    return undefined;
  }
  return numCommits;
}

/** Gets git data containing current branch and commit. */
export function getGitData(): Partial<Pick<GitData, "branch" | "commit">> {
  return {
    branch: getBranch(),
    commit: getCommit(),
  };
}
