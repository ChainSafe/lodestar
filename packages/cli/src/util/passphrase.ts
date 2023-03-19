import fs from "node:fs";
import {stripOffNewlines} from "./stripOffNewlines.js";

/**
 * Utility to read file as UTF8 and strip any trailing new lines.
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
    throw new Error(
      `passphraseFile ${passphraseFile} ${(e as Error).message}. Is this a well-formated passphraseFile?`
    );
  }

  return passphrase;
}
