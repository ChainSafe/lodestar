import path from "path";

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially

export const gitDataPath = path.resolve(__dirname, "../.git-data.json");

export type GitDataFile = {
  /** "0.16.0" */
  semver?: string;
  /** "developer/feature-1" */
  branch?: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit?: string;
};
