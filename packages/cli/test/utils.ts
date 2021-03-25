import fs from "fs";
import path from "path";
import tmp from "tmp";

const tmpDir = tmp.dirSync({unsafeCleanup: true});
export const testFilesDir = tmpDir.name;

export function getTestdirPath(filepath: string): string {
  const fullpath = path.join(testFilesDir, filepath);
  fs.mkdirSync(path.dirname(fullpath), {recursive: true});
  return fullpath;
}
