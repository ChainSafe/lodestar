import fs from "node:fs";
import {expose} from "@chainsafe/threads/worker";
import {Transfer, TransferDescriptor} from "@chainsafe/threads";
import {Keystore} from "@chainsafe/bls-keystore";
import {DecryptKeystoreArgs, DecryptKeystoreWorkerAPI, isLocalKeystoreDefinition} from "./types.js";

/**
 * Decrypt a single keystore, returning the secret key as a Uint8Array
 *
 * NOTE: This is a memory (and cpu) -intensive process, since decrypting the keystore involves running a key derivation function (either pbkdf2 or scrypt)
 */
export async function decryptKeystore(args: DecryptKeystoreArgs): Promise<TransferDescriptor<Uint8Array>> {
  const keystore = Keystore.parse(
    isLocalKeystoreDefinition(args) ? fs.readFileSync(args.keystorePath, "utf8") : args.keystoreStr
  );

  // Memory-hogging function
  const secret = await keystore.decrypt(args.password);
  // Transfer the underlying ArrayBuffer back to the main thread: https://threads.js.org/usage-advanced#transferable-objects
  // This small performance gain may help in cases where this is run for many keystores
  return Transfer(secret, [secret.buffer]);
}

expose({decryptKeystore} as unknown as DecryptKeystoreWorkerAPI);
