import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially.
//
// - For NPM release (stable): Only the version is persisted. Once must then track the version's tag
//   in Github to resolve that version to a specific commit. While this is okay, git-data.json gives
//   a gurantee of the exact commit at build time.
//
// - For NPM release (dev): canary commits include the commit, so this feature is not really
//   necessary. However, it's more cumbersome to have conditional logic on stable / dev.
//
// - For build from source: .git folder is available in the context of the built code, so it can extract
//   branch and commit directly without the need for .git-data.json.
//
// - For build from source dockerized: This feature is required to know the branch and commit, since
//   git data is not persisted past the build. However, .dockerignore prevents .git folder from being
//   copied into the container's context, so .git-data.json can't be generated.

/**
 * WARNING!! If you change this path make sure to update:
 * - 'packages/cli/package.json' -> .files -> `".git-data.json"`
 */
export const gitDataPath = path.resolve(__dirname, "../../../.git-data.json");

/** Git data type used to construct version information string and persistence. */
export type GitData = {
  /** "developer-feature" */
  branch: string;
  /** "80c248bb392f512cc115d95059e22239a17bbd7d" */
  commit: string;
};

/** Writes a persistent git data file. */
export function writeGitDataFile(gitData: GitData): void {
  fs.writeFileSync(gitDataPath, JSON.stringify(gitData, null, 2));
}

/** Reads the persistent git data file. */
export function readGitDataFile(): GitData {
  return JSON.parse(fs.readFileSync(gitDataPath, "utf8")) as GitData;
}
