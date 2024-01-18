import fs from "node:fs";
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

/** Remove a file if it exists */
export async function removeFile(path: string): Promise<boolean> {
  try {
    await promisify(fs.unlink)(path);
    return true;
  } catch (_) {
    // may not exists
    return false;
  }
}

export async function readFile(path: string): Promise<Uint8Array | null> {
  try {
    return await fs.promises.readFile(path);
  } catch (_) {
    return null;
  }
}

export async function readFileNames(folderPath: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(folderPath);
  } catch (_) {
    return [];
  }
}
