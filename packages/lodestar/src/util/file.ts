/**
 * @module util/file
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Recursively ensures directory exists by creating any missing directories
 * @param {string} filePath
 */
export function ensureDirectoryExistence(filePath: string): boolean {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
  return true;
}

export function rmDir(dir: string): void {
  const list = fs.readdirSync(dir);
  for (let i = 0; i < list.length; i++) {
    const filename = path.join(dir, list[i]);
    const stat = fs.statSync(filename);

    if (filename == "." || filename == "..") {
      // pass these files
    } else if (stat.isDirectory()) {
      // rmdir recursively
      rmDir(filename);
    } else {
      // rm fiilename
      fs.unlinkSync(filename);
    }
  }
  fs.rmdirSync(dir);
}
