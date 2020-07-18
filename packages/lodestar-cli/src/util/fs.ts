import fs from "fs";
import {stripOffNewlines} from "./stripOffNewlines";

/**
 * Create a file with `600 (-rw-------)` permissions
 * *Note*: 600: Owner has full read and write access to the file,
 * while no other user can access the file
 */
export function writeFile600Perm(filepath: string, data: string): void {
  fs.writeFileSync(filepath, data);
  fs.chmodSync(filepath, "0600");
}

/**
 * If `dirPath` does not exist, creates a directory recursively
 */
export function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

/**
 * Utility to read file as UTF8 and strip any trailing new lines
 * All passphrase files must be read with this function
 */
export function readPassphraseFile(passphraseFile: string): string {
  const data = fs.readFileSync(passphraseFile, "utf8");
  const passphrase = stripOffNewlines(data);

  // Validate the passphraseFile contents to prevent the user to create a wallet with a password
  // that is the contents a random unintended file
  try {
    if (passphrase.includes("\n")) throw Error("contains multiple lines");
    // 512 is an arbitrary high number that should be longer than any actual passphrase
    if (passphrase.length > 512) throw Error("is really long");
  } catch (e) {
    throw new Error(`passphraseFile ${passphraseFile} ${e.message}. Is this a well-formated passphraseFile?`);
  }

  return passphrase;
}