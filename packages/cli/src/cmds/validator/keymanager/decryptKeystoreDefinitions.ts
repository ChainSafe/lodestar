import fs from "node:fs";
import path from "node:path";
import {SecretKey} from "@chainsafe/blst";
import {Keystore} from "@chainsafe/bls-keystore";
import {SignerLocal, SignerType} from "@lodestar/validator";
import {LogLevel, Logger} from "@lodestar/utils";
import {lockFilepath, unlockFilepath} from "../../../util/lockfile.js";
import {LocalKeystoreDefinition} from "./interface.js";
import {clearKeystoreCache, loadKeystoreCache, writeKeystoreCache} from "./keystoreCache.js";
import {DecryptKeystoresThreadPool} from "./decryptKeystores/index.js";

export type KeystoreDecryptOptions = {
  ignoreLockFile?: boolean;
  onDecrypt?: (index: number) => void;
  // Try to use the cache file if it exists
  cacheFilePath?: string;
  /** Use main thread to decrypt keystores */
  disableThreadPool?: boolean;
  logger: Pick<Logger, LogLevel.info | LogLevel.warn | LogLevel.debug>;
  signal: AbortSignal;
};

type KeystoreDecryptError = {
  keystoreFile: string;
  error: Error;
};

/**
 * Decrypt keystore definitions using a thread pool
 */
export async function decryptKeystoreDefinitions(
  keystoreDefinitions: LocalKeystoreDefinition[],
  opts: KeystoreDecryptOptions
): Promise<SignerLocal[]> {
  if (keystoreDefinitions.length === 0) {
    return [];
  }

  if (opts.cacheFilePath) {
    try {
      const signers = await loadKeystoreCache(opts.cacheFilePath, keystoreDefinitions);

      for (const {keystorePath} of keystoreDefinitions) {
        lockKeystore(keystorePath, opts);
      }

      if (opts?.onDecrypt) {
        opts?.onDecrypt(signers.length - 1);
      }

      opts.logger.debug("Loaded keystores via keystore cache");

      return signers;
    } catch (_e) {
      // Some error loading the cache, ignore and invalidate cache
      await clearKeystoreCache(opts.cacheFilePath);
    }
  }

  const keystoreCount = keystoreDefinitions.length;
  const signers = new Array<SignerLocal>(keystoreCount);
  const passwords = new Array<string>(keystoreCount);
  const errors: KeystoreDecryptError[] = [];

  if (!opts.disableThreadPool) {
    const decryptKeystores = new DecryptKeystoresThreadPool(keystoreCount, opts.signal);

    for (const [index, definition] of keystoreDefinitions.entries()) {
      lockKeystore(definition.keystorePath, opts);

      decryptKeystores.queue(
        definition,
        (secretKeyBytes: Uint8Array) => {
          const signer: SignerLocal = {
            type: SignerType.Local,
            secretKey: SecretKey.fromBytes(secretKeyBytes),
          };

          signers[index] = signer;
          passwords[index] = definition.password;

          if (opts?.onDecrypt) {
            opts?.onDecrypt(index);
          }
        },
        (error: Error) => {
          // In-progress tasks can't be canceled, so there's a chance that multiple errors may be caught
          // add to the list of errors
          errors.push({keystoreFile: path.basename(definition.keystorePath), error});
          // cancel all pending tasks, no need to continue decrypting after we hit one error
          decryptKeystores.cancel();
        }
      );
    }

    await decryptKeystores.completed();
  } else {
    // Decrypt keystores in main thread
    for (const [index, definition] of keystoreDefinitions.entries()) {
      lockKeystore(definition.keystorePath, opts);

      try {
        const keystore = Keystore.parse(fs.readFileSync(definition.keystorePath, "utf8"));

        // Memory-hogging function
        const secretKeyBytes = await keystore.decrypt(definition.password);

        const signer: SignerLocal = {
          type: SignerType.Local,
          secretKey: SecretKey.fromBytes(secretKeyBytes),
        };

        signers[index] = signer;
        passwords[index] = definition.password;

        if (opts?.onDecrypt) {
          opts?.onDecrypt(index);
        }
      } catch (e) {
        errors.push({keystoreFile: path.basename(definition.keystorePath), error: e as Error});
        // stop processing, no need to continue decrypting after we hit one error
        break;
      }
    }
  }

  if (errors.length > 0) {
    // If an error occurs, the program isn't going to be running,
    // so we should unlock all lockfiles we created
    for (const {keystorePath} of keystoreDefinitions) {
      unlockFilepath(keystorePath);
    }

    throw formattedError(errors, signers, keystoreCount);
  }

  if (opts.cacheFilePath) {
    await writeKeystoreCache(opts.cacheFilePath, signers, passwords);
    opts.logger.debug("Written keystores to keystore cache");
  }

  return signers;
}

function lockKeystore(keystorePath: string, opts: KeystoreDecryptOptions): void {
  try {
    lockFilepath(keystorePath);
  } catch (e) {
    if (opts.ignoreLockFile) {
      opts.logger.warn("Keystore forcefully loaded even though lockfile exists", {
        path: keystorePath,
      });
    } else {
      throw e;
    }
  }
}

function formattedError(errors: KeystoreDecryptError[], signers: SignerLocal[], keystoreCount: number): Error {
  // Filter out errors due to terminating the thread pool
  // https://github.com/ChainSafe/threads.js/blob/df351552cb7d08b8465f5d1e7c543c952d74ac67/src/master/pool.ts#L244
  const decryptErrors = errors.filter(({error}) => !error.message.startsWith("Pool has been terminated"));

  const errorCount = decryptErrors.length;
  const decryptedCount = signers.filter(Boolean).length;
  const abortedCount = keystoreCount - errorCount - decryptedCount;

  let message = "Error importing keystores";

  if (errorCount === 1) {
    const {keystoreFile, error} = decryptErrors[0];
    message = `Error importing keystore\n\n${keystoreFile}: ${error.message}`;
  } else if (errorCount > 1) {
    message =
      "Multiple errors importing keystores\n\n" +
      decryptErrors.map(({keystoreFile, error}) => `${keystoreFile}: ${error.message}`).join("\n");
  }

  if (abortedCount > 0) {
    message += `\n\nAborted ${abortedCount} pending keystore import${abortedCount > 1 ? "s" : ""}`;
  }

  const error = new Error(message);

  // Don't print out stack trace
  error.stack = message;

  return error;
}
