import fs from "fs";
import findUp from "find-up";
import { getCommitsSinceRelease, getLatestTag, getGitData } from "./gitData";

type LernaJson = {
  /** "0.28.2-alpha" */
  version: string;
};

/**
 * Gathers all information on package version including Git data.
 * @returns a version string, e.g., "0.28.2-alpha+7(80c248bb)"
 */
export function getVersion(): string {
  let semver = getLatestTag();
  let numCommits = getCommitsSinceRelease();

  // Fall back to local version if git is unavailable
  if (semver === undefined) {
    semver = getLocalVersion();
  }

  if (numCommits === 0) {
    return `${semver}`;
  }

  let gitData = getGitData();
  let commit = gitData.commit?.slice(0, 8);
  return `${semver}/${gitData.branch}+${numCommits}(${commit})`;
}

/** Returns local version from `lerna.json` or `package.json` as `"0.28.2-alpha"` */
function getLocalVersion(): string | undefined {
  return readVersionFromLernaJson() || readCliPackageJson();
}

function readVersionFromLernaJson(): string | undefined {
  const filePath = findUp.sync("lerna.json");
  if (!filePath) return undefined;

  const lernaJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as LernaJson;
  return lernaJson.version;
}

function readCliPackageJson(): string | undefined {
  const filePath = findUp.sync("package.json", {cwd: __dirname});
  if (!filePath) return undefined;

  const packageJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as LernaJson;
  return packageJson.version;
}


// // This file is created in the build step and is distributed through NPM
// // MUST be in sync with packages/cli/src/gitData/gitDataPath.ts, and package.json .files
// import {GitDataFile, readGitDataFile} from "./gitDataPath";

// @TODO @q9f - read git data from file instead of exposing git everywhere

// /**
//  * Reads git data from a persisted file at build time + the current version in the package.json
//  */
// export function readLodestarGitData(): GitData {
//   try {
//     const semver = getLocalVersion() ?? undefined;
//     const currentGitData = getGitData();
//     const persistedGitData = getPersistedGitData();
//     // If the CLI is run from source, prioritze current git data over .git-data.json file, which might be stale
//     const gitData = {...persistedGitData, ...currentGitData};

//     return {
//       semver: semver || "-",
//       branch: gitData?.branch || "-",
//       commit: gitData?.commit || "-",
//       version: formatVersion({...gitData, semver}),
//     };
//   } catch (e) {
//     return {semver: "", branch: "", commit: "", version: e.message};
//   }
// }
