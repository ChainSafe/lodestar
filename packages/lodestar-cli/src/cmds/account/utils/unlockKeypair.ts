import fs from "fs";
import path from "path";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {Keystore} from "@chainsafe/bls-keystore";

/**
 * Name mapping of keystore to password file
 * Note: to be defined in EIP-2334
 * @param keystore 
 */
function secretFilenameGetter(keystore: Keystore): string {
  return `0x${keystore.pubkey}`;
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
  const keystore = Keystore.fromJSON(keystorePath);
  const passwordPath = path.join(secretsDir, secretFilenameGetter(keystore));
  const password = fs.readFileSync(passwordPath, "utf8");
  const privKey = keystore.decrypt(password);
  return new Keypair(PrivateKey.fromBytes(privKey));
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