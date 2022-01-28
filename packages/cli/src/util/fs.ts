import fs from "node:fs";
import path from "node:path";

/**
 * Create a file with `600 (-rw-------)` permissions
 * *Note*: 600: Owner has full read and write access to the file,
 * while no other user can access the file
 */
export function writeFile600Perm(filepath: string, data: string): void {
  ensureDirExists(path.dirname(filepath));
  fs.writeFileSync(filepath, data);
  fs.chmodSync(filepath, "0600");
}

/**
 * If `dirPath` does not exist, creates a directory recursively
 */
export function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}
