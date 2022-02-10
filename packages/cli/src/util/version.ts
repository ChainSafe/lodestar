import fs from "node:fs";
import findUp from "find-up";
import {readLodestarGitData} from "./gitData";
import {GitData} from "./gitData/gitDataPath";

type VersionJson = {
  /** "0.28.2" */
  version: string;
};

enum ReleaseTrack {
  git = "git",
  npm = "npm",
  nightly = "nightly",
  alpha = "alpha",
  beta = "beta",
  rc = "release candidate",
  stable = "stable",
  lts = "long term support",
}

/** Defines default release track, i.e., the "stability" of tag releases */
const defaultReleaseTrack = ReleaseTrack.alpha;

/**
 * Gathers all information on package version including Git data.
 * @returns a version string, e.g., `v0.28.2/developer-feature/+7/80c248bb (nightly)`
 */
export function getVersion(): string {
  const gitData: GitData = readLodestarGitData();
  let semver: string | undefined = gitData.semver;
  const numCommits: string | undefined = gitData.numCommits;
  const commitSlice: string | undefined = gitData.commit?.slice(0, 8);

  // ansible github branch deployment returns no semver
  semver = semver ?? `v${getLocalVersion()}`;

  // Tag release has numCommits as "0"
  if (!commitSlice || numCommits === "0") {
    return `${semver} (${defaultReleaseTrack})`;
  }

  // Otherwise get branch and commit information
  return `${semver}/${gitData.branch}/${numCommits}/${commitSlice} (${ReleaseTrack.git})`;
}

/** Exposes raw version data wherever needed for reporting (metrics, grafana). */
export function getVersionGitData(): GitData {
  return readLodestarGitData();
}

/** Returns local version from `lerna.json` or `package.json` as `"0.28.2"` */
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
