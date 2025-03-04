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

export async function getLastModifiedFile(folderPath: string): Promise<string | null> {
  const files = fs.readdirSync(folderPath);
  let lastModifiedFile = null;
  let lastModifiedTime = 0;

  // Iterate over each file and check its modification time
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);
    // Check if it's a file (not a directory)
    if (stats.isFile() && stats.mtimeMs > lastModifiedTime) {
      lastModifiedTime = stats.mtimeMs;
      lastModifiedFile = filePath;
    }
  }

  return lastModifiedFile;
}
