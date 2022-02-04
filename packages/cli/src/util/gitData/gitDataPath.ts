/**
 * Persist git data and distribute through NPM so CLI consumers can know exactly
 * at what commit was this src build. This is used in the metrics and to log initially.
 */

import path from "node:path";
import fs from "node:fs";

/**
 * WARNING!! If you change this path make sure to update:
 * - 'packages/cli/package.json' -> .files -> `".git-data.json"`
 */
export const gitDataPath = path.resolve(__dirname, "../../../.git-data.json");

/** Git data type used to construct version information string and persistence. */
export type GitData = {
  /** v0.28.2 */
  semver?: string;
  /** "developer-feature" */
  branch?: string;
  /** "80c248bb392f512cc115d95059e22239a17bbd7d" */
  commit?: string;
  /** +7 (commits since last tag) */
  numCommits?: string;
};

/** Writes a persistent git data file. */
export function writeGitDataFile(gitData: GitData): void {
  fs.writeFileSync(gitDataPath, JSON.stringify(gitData, null, 2));
}

/** Reads the persistent git data file. */
export function readGitDataFile(): GitData {
  return JSON.parse(fs.readFileSync(gitDataPath, "utf8")) as GitData;
}
