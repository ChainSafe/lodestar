import fs from "node:fs";
import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";
import {Transfer, TransferDescriptor} from "@chainsafe/threads";
import {Keystore} from "@chainsafe/bls-keystore";
import {DecryptKeystoreArgs, DecryptKeystoreWorkerAPI, isLocalKeystoreDefinition} from "./types.js";

/**
 * @param buffer The ArrayBuffer to be returned as transferable
 * @returns a buffer that can be transferred. If the provided buffer is marked as untransferable, a copy is returned
 */
function transferableArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const unknownWorker = worker as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  const isMarkedAsUntransferable = unknownWorker["isMarkedAsUntransferable"];
  // Can be updated to direct access once minimal version of node is 21
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  if (isMarkedAsUntransferable && isMarkedAsUntransferable(buffer)) {
    // Return a copy of the buffer so that it can be transferred
    return buffer.slice(0);
  } else {
    return buffer;
  }
}

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
  return Transfer(secret, [transferableArrayBuffer(secret.buffer)]);
}

expose({decryptKeystore} as unknown as DecryptKeystoreWorkerAPI);
