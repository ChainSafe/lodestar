import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import {Keystore} from "@chainsafe/bls-keystore";
import {YargsError, getPubkeyHexFromKeystore, readPassphraseFile, recursiveLookup} from "../../../util/index.js";
import {LocalKeystoreDefinition} from "../keymanager/interface.js";

type ImportKeystoreDefinitionsFromExternalDirArgs =
  | {
      keystoresPath: string[];
      password: string;
    }
  | {
      keystoresPath: string[];
      passwordsDir: string;
    };

/**
 * Imports keystores from un-controlled directories provided by the user.
 * This directories are expected to contain other files, so some filtering in done to improve UX.
 * @param args
 */
export function importKeystoreDefinitionsFromExternalDir(
  args: ImportKeystoreDefinitionsFromExternalDirArgs
): LocalKeystoreDefinition[] {
  if (!("password" in args)) {
    assertValidPasswordsDir(args.passwordsDir);
  }

  const keystorePaths = getVotingKeystorePaths(args.keystoresPath);

  if ("password" in args) {
    return keystorePaths.map((keystorePath) => ({
      keystorePath,
      password: args.password,
    }));
  }

  return keystorePaths.map((keystorePath) => ({
    keystorePath,
    password: readPassphraseFile(getPasswordFilepathForKeystore(keystorePath, args.passwordsDir)),
  }));
}

export async function readKeystoreDefinitionsFromArgs(args: {
  keystoresPath: string[];
  importKeystoresPassword?: string;
  importKeystoresPasswords?: string;
}): Promise<LocalKeystoreDefinition[]> {
  if (args.importKeystoresPasswords) {
    return importKeystoreDefinitionsFromExternalDir({
      keystoresPath: args.keystoresPath,
      passwordsDir: args.importKeystoresPasswords,
    });
  }

  return importKeystoreDefinitionsFromExternalDir({
    keystoresPath: args.keystoresPath,
    password: await readPassphraseOrPrompt(args),
  });
}

function getVotingKeystorePaths(keystoresPath: string[]): string[] {
  const allFiles: string[] = [];

  for (const keystorePath of keystoresPath) {
    assertValidKeystoresPath(keystorePath);
    recursiveLookup(keystorePath, allFiles);
  }

  return allFiles.filter((filepath) => isVotingKeystore(filepath));
}

function assertValidKeystoresPath(keystorePath: string): void {
  if (!fs.existsSync(keystorePath)) {
    throw new YargsError(`importKeystores must point to an existing file or directory: ${keystorePath}`);
  }
}

function assertValidPasswordsDir(passwordsDir: string): void {
  if (!fs.existsSync(passwordsDir)) {
    throw new YargsError(`importKeystoresPasswords must point to an existing directory: ${passwordsDir}`);
  }

  if (!fs.statSync(passwordsDir).isDirectory()) {
    throw new YargsError(`importKeystoresPasswords must point to a directory: ${passwordsDir}`);
  }
}

function getPasswordFilepathForKeystore(keystorePath: string, passwordsDir: string): string {
  let pubkeyHex: string;
  try {
    const keystore = Keystore.parse(fs.readFileSync(keystorePath, "utf8"));
    pubkeyHex = getPubkeyHexFromKeystore(keystore);
  } catch (e) {
    throw new YargsError(`Failed to read keystore ${keystorePath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const passwordFilepath = path.join(passwordsDir, `${pubkeyHex.toLowerCase()}.txt`);

  if (!fs.existsSync(passwordFilepath)) {
    throw new YargsError(
      `No password file found for keystore ${keystorePath}. Expected password file ${passwordFilepath}`
    );
  }

  return passwordFilepath;
}

export async function readPassphraseOrPrompt(args: {importKeystoresPassword?: string}): Promise<string> {
  if (args.importKeystoresPassword) {
    return readPassphraseFile(args.importKeystoresPassword);
  }

  const answers = await inquirer.prompt<{password: string}>([
    {
      name: "password",
      type: "password",
      message: "Enter the keystore(s) password",
    },
  ]);

  return answers.password;
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
