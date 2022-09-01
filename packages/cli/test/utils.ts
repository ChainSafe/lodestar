import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";

export const networkDev = "dev";

const tmpDir = tmp.dirSync({unsafeCleanup: true});
export const testFilesDir = tmpDir.name;

export function getTestdirPath(filepath: string): string {
  const fullpath = path.join(testFilesDir, filepath);
  fs.mkdirSync(path.dirname(fullpath), {recursive: true});
  return fullpath;
}
