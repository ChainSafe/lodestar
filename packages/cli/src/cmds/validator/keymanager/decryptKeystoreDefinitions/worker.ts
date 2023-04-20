import fs from "node:fs";
import {expose} from "@chainsafe/threads/worker";
import {Transfer, TransferDescriptor} from "@chainsafe/threads";
import {Keystore} from "@chainsafe/bls-keystore";
import {LocalKeystoreDefinition} from "../interface.js";
import {DecryptKeystoreWorkerAPI} from "./types.js";

/**
 * Decrypt a single keystore definition, returning the secret key as a Uint8Array
 *
 * NOTE: This is a memory (and cpu) -intensive process, since decrypting the keystore involves running a key derivation function (either pbkdf2 or scrypt)
 */
export async function decryptKeystoreDefinition({
  keystorePath,
  password,
}: LocalKeystoreDefinition): Promise<TransferDescriptor<Uint8Array>> {
  const keystore = Keystore.parse(fs.readFileSync(keystorePath, "utf8"));

  // Memory-hogging function
  const secret = await keystore.decrypt(password);
  // Transfer the underlying ArrayBuffer back to the main thread: https://threads.js.org/usage-advanced#transferable-objects
  // This small performance gain may help in cases where this is run for many keystores
  return Transfer(secret, [secret.buffer]);
}

expose({decryptKeystoreDefinition} as unknown as DecryptKeystoreWorkerAPI);
