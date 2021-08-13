import path from "path";
import fs from "fs";

/**
 * WARNING!! If you change this path make sure to update:
 * - 'packages/cli/package.json' -> .files -> `".git-data.json"`
 */
export const gitDataPath = path.resolve(__dirname, "../../../.git-data.json");

export type GitDataFile = {
  /** "developer/feature-1" */
  branch?: string;
  /** "80c248bb392f512cc115d95059e22239a17bbd7d" */
  commit?: string;
};

/** Writs a persistent git data file. */
export function writeGitDataFile(gitData: GitDataFile): void {
  fs.writeFileSync(gitDataPath, JSON.stringify(gitData, null, 2));
}


/** Reads the persistent git data file. */
export function readGitDataFile(): GitDataFile {
  return JSON.parse(fs.readFileSync(gitDataPath, "utf8")) as GitDataFile;
}
