import fs from "node:fs";
import {expose} from "@chainsafe/threads/worker";
import {Keystore} from "@chainsafe/bls-keystore";
import {LocalKeystoreDefinition} from "../interface.js";
import {DecryptKeystoreWorkerAPI} from "./types.js";

/**
 * Decrypt a single keystore definition, returning the secret key as a Uint8Array
 *
 * NOTE: This is memory-intensive process, since decrypting the keystore involves running a key derivation function (either pbkdf2 or scrypt)
 */
export async function decryptKeystoreDefinition({
  keystorePath,
  password,
}: LocalKeystoreDefinition): Promise<Uint8Array> {
  const keystore = Keystore.parse(fs.readFileSync(keystorePath, "utf8"));

  // Memory-hogging function
  return keystore.decrypt(password);
}

expose({decryptKeystoreDefinition} as DecryptKeystoreWorkerAPI);
