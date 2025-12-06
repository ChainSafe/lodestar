import fs from "node:fs";
import {Keystore} from "@chainsafe/bls-keystore";
import {DecryptKeystoreArgs, isLocalKeystoreDefinition} from "./types.js";

/**
 * Decrypt a single keystore, returning the secret key as a Uint8Array
 *
 * NOTE: This is a memory (and cpu) -intensive process, since decrypting the keystore involves running a key derivation function (either pbkdf2 or scrypt)
 */
export default async function decryptKeystore(args: DecryptKeystoreArgs): Promise<Uint8Array> {
  const keystore = Keystore.parse(
    isLocalKeystoreDefinition(args) ? fs.readFileSync(args.keystorePath, "utf8") : args.keystoreStr
  );

  // Memory-hogging function
  const secret = await keystore.decrypt(args.password);
  // Return the secret directly - piscina handles transferring via the transferList option
  // in the main thread if needed. For small keys like BLS secret keys (32 bytes),
  // the structured clone overhead is negligible.
  return secret;
}
