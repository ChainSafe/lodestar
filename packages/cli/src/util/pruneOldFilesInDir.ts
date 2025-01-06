import fs from "node:fs";
import path from "node:path";

export function pruneOldFilesInDir(dirpath: string, maxAgeMs: number): number {
  if (!fs.existsSync(dirpath)) {
    return 0; // Nothing to prune
  }

  let deletedFileCount = 0;
  for (const entryName of fs.readdirSync(dirpath)) {
    const entryPath = path.join(dirpath, entryName);

    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      deletedFileCount += pruneOldFilesInDir(entryPath, maxAgeMs);
    } else if (stat.isFile()) {
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(entryPath);
        deletedFileCount += 1;
      }
    }
  }

  // if all files are deleted, delete the directory
  if (fs.readdirSync(dirpath).length === 0) {
    fs.rmdirSync(dirpath);
  }
  return deletedFileCount;
}
