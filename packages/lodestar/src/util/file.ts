/**
 * @module util/file
 */

import fs from "node:fs";
import path from "node:path";
import {promisify} from "node:util";

/** Ensure a directory exists */
export async function ensureDir(path: string): Promise<void> {
  try {
    await promisify(fs.stat)(path);
  } catch (_) {
    // not exists
    await promisify(fs.mkdir)(path, {recursive: true});
  }
}

/** Write data to a file if it does not exist */
export async function writeIfNotExist(filepath: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await promisify(fs.stat)(filepath);
    return false;
    // file exists, do nothing
  } catch (_) {
    // not exists
    await promisify(fs.writeFile)(filepath, bytes);
    return true;
  }
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
