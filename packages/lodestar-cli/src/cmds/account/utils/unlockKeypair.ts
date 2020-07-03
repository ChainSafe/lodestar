import fs from "fs";
import path from "path";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {Keystore} from "@chainsafe/bls-keystore";

/**
 * Name mapping of keystore to password file
 * Note: to be defined in EIP-2334
 * @param keystore Encrypted keystore object
 * @param secretsDir Directory containing keystore passwords
 */
function readPasswordFile(keystore: Keystore, secretsDir: string): string {
  const passwordPath = path.join(secretsDir, `0x${keystore.pubkey}`);
  try {
    // Data may end with '\n', trim it
    return fs.readFileSync(passwordPath, "utf8").trim();
  } catch (e) {
    if (e.code === "ENOENT") {
      throw Error(`password file not found at expected path ${passwordPath}`);
    } else {
      throw e;
    }
  }
}

/**
 * Opens a validator directory and decrypts its keypair
 * @param kwargs.keystorePath Path to a EIP-2335 keystore
 * @param kwargs.secretsDir Directory containing keystore passwords
 */
export function unlockKeypair({
  keystorePath,
  secretsDir,
}: {
  keystorePath: string;
  secretsDir: string;
}): Keypair {
  try {
    const keystore = Keystore.fromJSON(fs.readFileSync(keystorePath, "utf8"));
    const password = readPasswordFile(keystore, secretsDir);
    const privKey = keystore.decrypt(password);
    return new Keypair(PrivateKey.fromBytes(privKey));
  } catch (e) {
    e.message = `Error unlocking keystore ${keystorePath}: ${e.message}`;
    throw e;
  }
}

/**
 * Opens all the validator directories and decrypts the validator keypairs
 * @param kwargs.keystoresDir Directory containing EIP-2335 keystores
 * @param kwargs.secretsDir Directory containing a password for each keystore
 */
export function unlockDirKeypairs({
  keystoresDir,
  secretsDir,
}: {
  keystoresDir: string;
  secretsDir: string;
}): Keypair[] {
  return fs.readdirSync(keystoresDir).map(keystoreFilename => 
    unlockKeypair({
      keystorePath: path.join(keystoresDir, keystoreFilename),
      secretsDir
    })
  );
}