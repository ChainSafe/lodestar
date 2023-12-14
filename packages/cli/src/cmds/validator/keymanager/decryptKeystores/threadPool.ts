import path from "node:path";
import {spawn, Pool, Worker, ModuleThread, QueuedTask} from "@chainsafe/threads";
import {DecryptKeystoreArgs, DecryptKeystoreWorkerAPI} from "./types.js";
import {maxPoolSize} from "./poolSize.js";

// Worker constructor consider the path relative to the current working directory
const workerDir =
  process.env.NODE_ENV === "test" ? "../../../../../lib/cmds/validator/keymanager/decryptKeystores" : "./";

/**
 * Thread pool to decrypt keystores
 */
export class DecryptKeystoresThreadPool {
  private pool: Pool<ModuleThread<DecryptKeystoreWorkerAPI>>;
  private tasks: QueuedTask<ModuleThread<DecryptKeystoreWorkerAPI>, Uint8Array>[] = [];
  private terminatePoolHandler: () => void;

  constructor(
    keystoreCount: number,
    private readonly signal: AbortSignal
  ) {
    this.pool = Pool(
      () =>
        spawn<DecryptKeystoreWorkerAPI>(new Worker(path.join(workerDir, "worker.js")), {
          // The number below is big enough to almost disable the timeout
          // which helps during tests run on unpredictably slow hosts
          timeout: 5 * 60 * 1000,
        }),
      {
        // Adjust worker pool size based on keystore count
        size: Math.min(keystoreCount, maxPoolSize),
        // Decrypt keystores in sequence, increasing concurrency does not improve performance
        concurrency: 1,
      }
    );
    // Terminate worker threads when process receives exit signal
    this.terminatePoolHandler = () => {
      void this.pool.terminate(true);
    };
    signal.addEventListener("abort", this.terminatePoolHandler, {once: true});
  }

  /**
   * Add keystore to the task queue to be decrypted
   */
  queue(
    args: DecryptKeystoreArgs,
    onDecrypted: (secretKeyBytes: Uint8Array) => void,
    onError: (e: Error) => void
  ): void {
    const task = this.pool.queue((thread) => thread.decryptKeystore(args));
    this.tasks.push(task);
    task.then(onDecrypted).catch(onError);
  }

  /**
   * Resolves once all queued tasks are completed and terminates worker threads.
   * Errors during executing can be captured in `onError` handler for each task.
   */
  async completed(): Promise<void> {
    await this.pool.settled(true);
    await this.pool.terminate();
    this.signal.removeEventListener("abort", this.terminatePoolHandler);
  }

  /**
   * Cancel all pending tasks
   */
  cancel(): void {
    for (const task of this.tasks) {
      task.cancel();
    }
    this.tasks = [];
  }
}
