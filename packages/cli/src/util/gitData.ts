import fs from "fs";
import path from "path";
import {execSync} from "child_process";
import {getLocalVersion} from "./version";

// This file is created in the build step and is distributed through NPM
// MUST be in sync with packages/cli/scripts/getGitData.js, and package.json .files
const LOCAL_GIT_DATA_FILEPATH = path.join(__dirname, "../../.git-data.json");

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
type GitData = {
  /** "0.16.0" */
  semver: string;
  /** "developer/feature-1" */
  branch: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "0.16.0 developer/feature-1 ac99f2b5" */
  version: string;
};

/**
 * Reads git data injected on the Dockerfile to the filepath `DOCKER_LODESTAR_GIT_DATA_FILEPATH`
 * Expects a file with JSON contents:
 * ```js
 * {
 *   version: "0.16.0",
 *   branch: "developer/feature-1",
 *   commit: "4f816b16dfde718e2d74f95f2c8292596138c248"
 * }
 * ```
 */
export function readLodestarGitData(): GitData {
  try {
    const semver = getLocalVersion() ?? undefined;
    const currentGitData = getGitData();
    const persistedGitData = getPersistedGitData();
    // If the CLI is run from source, prioritze current git data over .git-data.json file, which might be stale
    const gitData = {...persistedGitData, ...currentGitData};

    return {
      semver: semver || "-",
      branch: gitData?.branch || "-",
      commit: gitData?.commit || "-",
      version: formatVersion({...gitData, semver}),
    };
  } catch (e) {
    return {semver: "", branch: "", commit: "", version: e.message};
  }
}

function formatVersion({semver, branch, commit}: Partial<GitData>): string {
  return [semver, branch, commit && commit.slice(0, 8)].filter((s) => s).join(" ");
}

function getGitData(): Partial<GitData> {
  try {
    const shell = (cmd: string): string =>
      execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
        .toString()
        .trim();
    const branch = shell("git rev-parse --abbrev-ref HEAD");
    const commit = shell("git rev-parse --verify HEAD");
    return {branch, commit};
  } catch (e) {
    return {};
  }
}

function getPersistedGitData(): Partial<GitData> {
  try {
    const gitDataFilepath = process?.env?.DOCKER_LODESTAR_GIT_DATA_FILEPATH || LOCAL_GIT_DATA_FILEPATH;

    // eslint-disable-next-line
    const gitData = JSON.parse(fs.readFileSync(gitDataFilepath, "utf8"));
    const {version: semver, branch, commit} = gitData;
    return {semver, branch, commit, version: `${semver} ${branch} ${commit.slice(0, 8)}`};
  } catch (e) {
    return {};
  }
}
