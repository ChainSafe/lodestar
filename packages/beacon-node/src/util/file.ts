import {readFile as fsReadFile, mkdir, readdir, stat, unlink, writeFile} from "node:fs/promises";

/** Ensure a directory exists */
export async function ensureDir(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (_) {
    // not exists
    await mkdir(path, {recursive: true});
  }
}

/** Write data to a file if it does not exist */
export async function writeIfNotExist(filepath: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await stat(filepath);
    return false;
    // file exists, do nothing
  } catch (_) {
    // not exists
    await writeFile(filepath, bytes);
    return true;
  }
}

/** Remove a file if it exists */
export async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (_) {
    // may not exists
    return false;
  }
}

export async function readFile(path: string): Promise<Uint8Array | null> {
  try {
    return await fsReadFile(path);
  } catch (_) {
    return null;
  }
}

export async function readFileNames(folderPath: string): Promise<string[]> {
  try {
    return await readdir(folderPath);
  } catch (_) {
    return [];
  }
}
