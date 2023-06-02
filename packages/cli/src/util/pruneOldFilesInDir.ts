import fs from "node:fs";
import path from "node:path";

export function pruneOldFilesInDir(dirpath: string, maxAgeMs: number): void {
  for (const entryName of fs.readdirSync(dirpath)) {
    const entryPath = path.join(dirpath, entryName);

    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      pruneOldFilesInDir(entryPath, maxAgeMs);
    } else if (stat.isFile()) {
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(entryPath);
      }
    }
  }
}
