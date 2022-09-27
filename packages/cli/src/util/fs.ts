import fs from "node:fs";
import path from "node:path";

/**
 * Maybe create a directory
 */
export function mkdir(dirname: string): void {
  if (!fs.existsSync(dirname)) fs.mkdirSync(dirname, {recursive: true});
}

/** NodeJS POSIX errors subset */
type ErrorFs = Error & {code: "ENOENT" | "ENOTDIR"};

/**
 * Attempts to unlink a file, return true if it is deleted, false if not found
 */
export function unlinkSyncMaybe(filepath: string): boolean {
  try {
    fs.unlinkSync(filepath);
    return true;
  } catch (e) {
    const {code} = e as ErrorFs;
    if (code === "ENOENT") return false;
    else throw e;
  }
}

/**
 * Attempts rm a dir, return true if it is deleted, false if not found
 */
export function rmdirSyncMaybe(dirpath: string): boolean {
  try {
    fs.rmSync(dirpath, {recursive: true});
    return true;
  } catch (e) {
    const {code} = e as ErrorFs;
    // about error codes https://nodejs.org/api/fs.html#fspromisesrmdirpath-options
    // ENOENT error on Windows and an ENOTDIR
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    else throw e;
  }
}

/**
 * Find all files recursively in `dirPath`
 */
export function recursiveLookup(dirPath: string, filepaths: string[] = []): string[] {
  if (fs.statSync(dirPath).isDirectory()) {
    for (const filename of fs.readdirSync(dirPath)) {
      recursiveLookup(path.join(dirPath, filename), filepaths);
    }
  } else {
    filepaths.push(dirPath);
  }

  return filepaths;
}
