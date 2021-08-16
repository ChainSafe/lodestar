import fs from "fs";
import findUp from "find-up";
import {readLodestarGitData} from "./gitData";
import {GitData} from "./gitData/gitDataPath";

type VersionJson = {
  /** "0.28.2-alpha" */
  version: string;
};

/**
 * Gathers all information on package version including Git data.
 * @returns a version string, e.g., `v0.28.2-alpha/developer-feature/+7(80c248bb)`
 */
export function getVersion(): string {
  const gitData: GitData = readLodestarGitData();
  let semver: string | undefined = gitData.semver;
  const numCommits: string | undefined = gitData.numCommits;
  const commitSlice: string | undefined = gitData.commit?.slice(0, 8);

  // Fall back to local version if git is unavailable
  if (!semver) {
    semver = getLocalVersion();
  }

  // If these values are empty/undefined, we assume tag release.
  if (!commitSlice || !numCommits || numCommits === "") {
    return `${semver}`;
  }

  // Otherwise get branch and commit information
  return `${semver}/${gitData.branch}/${numCommits}(${commitSlice})`;
}

/** Returns local version from `lerna.json` or `package.json` as `"0.28.2-alpha"` */
function getLocalVersion(): string | undefined {
  return readVersionFromLernaJson() || readCliPackageJson();
}

/** Read version information from lerna.json */
function readVersionFromLernaJson(): string | undefined {
  const filePath = findUp.sync("lerna.json", {cwd: __dirname});
  if (!filePath) return undefined;

  const lernaJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as VersionJson;
  return lernaJson.version;
}

/** Read version information from package.json */
function readCliPackageJson(): string | undefined {
  const filePath = findUp.sync("package.json", {cwd: __dirname});
  if (!filePath) return undefined;

  const packageJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as VersionJson;
  return packageJson.version;
}
