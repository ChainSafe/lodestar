import {spawn, ModuleThread, Pool, QueuedTask, Worker} from "@chainsafe/threads";
import {SignerLocal, SignerType} from "@lodestar/validator";
import bls from "@chainsafe/bls";
import {LocalKeystoreDefinition} from "../interface.js";
import {clearKeystoreCache, loadKeystoreCache, writeKeystoreCache} from "../keystoreCache.js";
import {lockFilepath, unlockFilepath} from "../../../../util/lockfile.js";
import {defaultPoolSize} from "./poolSize.js";
import {DecryptKeystoreWorkerAPI, KeystoreDecryptOptions} from "./types.js";

/**
 * Decrypt keystore definitions using a threadpool
 */
export async function decryptKeystoreDefinitions(
  keystoreDefinitions: LocalKeystoreDefinition[],
  opts: KeystoreDecryptOptions
): Promise<SignerLocal[]> {
  if (opts.cacheFilePath) {
    try {
      const signers = await loadKeystoreCache(opts.cacheFilePath, keystoreDefinitions);
      if (opts?.onDecrypt) {
        opts?.onDecrypt(signers.length - 1);
      }
      opts.logger.debug("Loaded keystores via keystore cache");
      return signers;
    } catch {
      // Some error loading the cache, ignore and invalidate cache
      await clearKeystoreCache(opts.cacheFilePath);
    }
  }

  const signers = new Array(keystoreDefinitions.length) as SignerLocal[];
  const passwords = new Array(keystoreDefinitions.length) as string[];
  const tasks: QueuedTask<ModuleThread<DecryptKeystoreWorkerAPI>, Uint8Array>[] = [];
  const errors: Error[] = [];
  const pool = Pool(
    () =>
      spawn<DecryptKeystoreWorkerAPI>(new Worker("./worker.js"), {
        // The number below is big enough to almost disable the timeout which helps during tests run on unpredictablely slow hosts
        timeout: 5 * 60 * 1000,
      }),
    defaultPoolSize
  );
  for (const [index, definition] of keystoreDefinitions.entries()) {
    try {
      lockFilepath(definition.keystorePath);
    } catch (e) {
      if (opts.ignoreLockFile) {
        opts.logger.warn("Keystore forcefully loaded even though lockfile exists", {
          path: definition.keystorePath,
        });
      } else {
        throw e;
      }
    }

    const task = pool.queue((thread) => thread.decryptKeystoreDefinition(definition));
    tasks.push(task);
    task
      .then((secretKeyBytes: Uint8Array) => {
        const signer: SignerLocal = {
          type: SignerType.Local,
          secretKey: bls.SecretKey.fromBytes(secretKeyBytes),
        };

        signers[index] = signer;
        passwords[index] = definition.password;

        if (opts?.onDecrypt) {
          opts?.onDecrypt(index);
        }
      })
      .catch((e: Error) => {
        // In-progress tasks can't be canceled, so there's a chance that multiple errors may be caught
        // add to the list of errors
        errors.push(e);
        // cancel all pending tasks, no need to continue decrypting after we hit one error
        for (const task of tasks) {
          task.cancel();
        }
      });
  }

  try {
    // only resolves if there are no errored tasks
    await pool.completed(true);
  } catch (e) {
    // If an error occurs, the program isn't going to be running,
    // so we should unlock all lockfiles we created
    for (const {keystorePath} of keystoreDefinitions) {
      unlockFilepath(keystorePath);
    }

    throw new AggregateError(errors);
  } finally {
    await pool.terminate();
  }

  if (opts.cacheFilePath) {
    await writeKeystoreCache(opts.cacheFilePath, signers, passwords);
    opts.logger.debug("Written keystores to keystore cache");
  }

  return signers;
}
