import {execSync} from "child_process";
import { readGitDataFile, GitData } from "./gitDataPath";

/**
 * Persist git data and distribute through NPM so CLI consumers can know exactly
 * at what commit was this source build. This is also used in the metrics and to log initially.
 */


/** Silent shell that won't pollute stdout, or stderr */
function shell(cmd: string): string {
  return execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
    .toString()
    .trim();
}

/** Tries to get branch from git CLI. */
function getBranch(): string | undefined {
  try {
    return shell("git rev-parse --abbrev-ref HEAD");
  } catch (e) {
    return undefined;
  }
}

/** Tries to get commit from git from git CLI. */
function getCommit(): string | undefined {
  try {
    return shell("git rev-parse --verify HEAD");
  } catch (e) {
    return undefined;
  }
}

/** Tries to get the latest tag from git CLI. */
function getLatestTag(): string | undefined {
  try {
    return shell("git describe --abbrev=0");
  } catch (e) {
    return undefined;
  }
}

/** Gets number of commits since latest tag/release. */
function getCommitsSinceRelease(): number | undefined {
  let numCommits: number = 0;
  const latestTag: string | undefined = getLatestTag();
  try {
    numCommits = +shell(`git rev-list ${latestTag}..HEAD --count`);
  } catch (e) {
    return undefined;
  }
  return numCommits;
}

/** Reads git data from a persisted file or local git data at build time. */
export function readLodestarGitData(): GitData {
  try {
    const currentGitData = getGitData();
    const persistedGitData = getPersistedGitData();
    // If the CLI is run from source, prioritze current git data 
    // over .git-data.json file, which might be stale here.
    const gitData = {...persistedGitData, ...currentGitData};

    return {
      semver: gitData?.semver || "-",
      branch: gitData?.branch || "-",
      commit: gitData?.commit || "-",
      numCommits: gitData?.numCommits || "",
    };
  } catch (e) {
    return {semver: e.message, branch: "", commit: "", numCommits: ""};
  }
}

/** Wrapper for updating git data. ONLY to be used with build scripts! */
export function _forceUpdateGitData(): Partial<GitData> {
  return getGitData();
}

/** Gets git data containing current branch and commit info from CLI. */
function getGitData(): Partial<GitData> {
  const numCommits: number | undefined = getCommitsSinceRelease();
  let strCommits: string = "";
  if (numCommits && numCommits > 0) {
    strCommits = `+${numCommits}`;
  }
  return {
    branch: getBranch(),
    commit: getCommit(),
    semver: getLatestTag(),
    numCommits: strCommits,
  };
}

/** Gets git data containing current branch and commit info from persistent file. */
function getPersistedGitData(): Partial<GitData> {
  try {
    return readGitDataFile();
  } catch (e) {
    return {};
  }
}
