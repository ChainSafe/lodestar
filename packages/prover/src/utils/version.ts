import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {findUpSync} from "find-up";
import {readAndGetGitData} from "./gitData/index.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type VersionJson = {
  /** "0.28.2" */
  version: string;
};

const BRANCH_IGNORE = /^(HEAD|master|unstable|main)$/;

/**
 * Gathers all information on package version including Git data.
 * @returns a version string, e.g.
 * - Stable release: `v0.36.0/80c248bb`
 * - Dev release: `v0.36.0-dev.80c248bb/80c248bb`
 * - Test branch: `v0.36.0/developer-feature/80c248bb`
 */
export function getVersionData(): {
  version: string;
  commit: string;
} {
  const parts: string[] = [];

  /** Returns local version from `lerna.json` or `package.json` as `"0.28.2"` */
  const localVersion = readCliPackageJson() || readVersionFromLernaJson();
  if (localVersion) {
    parts.push(`v${localVersion}`);
  }

  const {branch, commit} = readAndGetGitData();

  // Add branch only if not present and not an ignore value
  if (branch && !BRANCH_IGNORE.test(branch)) parts.push(branch);

  // Add commit only if present. 7 characters to be consistent with Github
  if (commit) {
    const commitShort = commit.slice(0, 7);
    // Don't add commit if it's already in the version string (dev versions)
    if (!localVersion || !localVersion.includes(commitShort)) {
      parts.push(commitShort);
    }
  }

  return {
    // Guard against empty parts array
    version: parts.length > 0 ? parts.join("/") : "unknown",
    commit,
  };
}

/** Read version information from lerna.json */
function readVersionFromLernaJson(): string | undefined {
  const filePath = findUpSync("lerna.json", {cwd: __dirname});
  if (!filePath) return undefined;

  const lernaJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as VersionJson;
  return lernaJson.version;
}

/** Read version information from package.json */
function readCliPackageJson(): string | undefined {
  const filePath = findUpSync("package.json", {cwd: __dirname});
  if (!filePath) return undefined;

  const packageJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as VersionJson;
  return packageJson.version;
}
