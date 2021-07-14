import fs from "fs";
import path from "path";

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially

/**
 * WARNING!! If you change this path make sure to update:
 * - 'packages/cli/package.json' -> .files -> `".git-data.json"`
 */
export const gitDataPath = path.resolve(__dirname, "../.git-data.json");

export type GitDataFile = {
  /** "developer/feature-1" */
  branch?: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit?: string;
};

export function readGitDataFile(): GitDataFile {
  return JSON.parse(fs.readFileSync(gitDataPath, "utf8")) as GitDataFile;
}

export function writeGitDataFile(gitData: GitDataFile): void {
  fs.writeFileSync(gitDataPath, JSON.stringify(gitData, null, 2));
}
