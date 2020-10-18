import fs from "fs";
import path from "path";

export const testFilesDir = "./.test-files";

export function getTestdirPath(filepath: string): string {
  const fullpath = path.join(testFilesDir, filepath);
  fs.mkdirSync(path.dirname(fullpath), {recursive: true});
  return fullpath;
}
