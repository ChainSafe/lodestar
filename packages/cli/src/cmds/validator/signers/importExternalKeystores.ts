import inquirer from "inquirer";
import {readPassphraseFile, recursiveLookup} from "../../../util/index.js";
import {LocalKeystoreDefinition} from "../keymanager/persistedKeys.js";

/**
 * Imports keystores from un-controlled directories provided by the user.
 * This directories are expected to contain other files, so some filtering in done to improve UX.
 * @param args
 */
export function importKeystoreDefinitionsFromExternalDir(args: {
  keystoresPath: string[];
  password: string;
}): LocalKeystoreDefinition[] {
  const allFiles: string[] = [];

  for (const keystorePath of args.keystoresPath) {
    recursiveLookup(keystorePath, allFiles);
  }

  return allFiles
    .filter((filepath) => isVotingKeystore(filepath))
    .map((keystorePath) => ({
      keystorePath,
      password: args.password,
    }));
}

export async function readPassphraseOrPrompt(args: {importKeystoresPassword?: string}): Promise<string> {
  if (args.importKeystoresPassword) {
    return readPassphraseFile(args.importKeystoresPassword);
  } else {
    const answers = await inquirer.prompt<{password: string}>([
      {
        name: "password",
        type: "password",
        message: "Enter the keystore(s) password",
      },
    ]);

    // eslint-disable-next-line no-console
    console.log("Password is correct");

    return answers.password;
  }
}

/**
 * Returns `true` if we should consider the `filename` to represent a voting keystore.
 */
export function isVotingKeystore(filename: string): boolean {
  // All formats end with `.json`.
  return (
    filename.endsWith(".json") &&
    // The staking-deposit-cli tool outputs a deposit_data file in the directory users typically import from.
    // Ignoring that file is very helpful for UX, and it's very unlikely that someone names their keystore that way.
    !/deposit_data-\d+\.json$/gi.test(filename)
    // Note: Previously this tool only imported the exact naming from the staking-deposit-cli tool.
    //       However, that's too restrictive. Guide left here as a reference
    //
    // The format exported by the `staking-deposit-cli` library.
    //
    // Reference to function that generates keystores:
    // https://github.com/ethereum/staking-deposit-cli/blob/7cebff15eac299b3b1b090c896dd3410c8463450/eth2deposit/credentials.py#L58-L62
    //
    // Since we include the key derivation path of `m/12381/3600/x/0/0` this should only ever match
    // with a voting keystore and never a withdrawal keystore.
    //
    // Key derivation path reference:
    //
    // https://eips.ethereum.org/EIPS/eip-2334
  );
}
