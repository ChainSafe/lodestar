import path from "node:path";
import {fileURLToPath} from "node:url";
import {Piscina} from "piscina";
import {maxPoolSize} from "./poolSize.js";
import {DecryptKeystoreArgs} from "./types.js";

// Resolve worker path relative to this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath =
  process.env.NODE_ENV === "test"
    ? path.join(__dirname, "../../../../../lib/cmds/validator/keymanager/decryptKeystores/worker.js")
    : path.join(__dirname, "worker.js");

type PendingTask = {
  controller: AbortController;
  promise: Promise<Uint8Array>;
};

/**
 * Thread pool to decrypt keystores
 */
export class DecryptKeystoresThreadPool {
  private pool: Piscina;
  private tasks: PendingTask[] = [];
  private terminatePoolHandler: () => void;

  constructor(
    keystoreCount: number,
    private readonly signal: AbortSignal
  ) {
    this.pool = new Piscina({
      filename: workerPath,
      // Adjust worker pool size based on keystore count
      minThreads: Math.min(keystoreCount, maxPoolSize),
      maxThreads: Math.min(keystoreCount, maxPoolSize),
      // Decrypt keystores in sequence per worker, increasing concurrency does not improve performance
      concurrentTasksPerWorker: 1,
      // Enable timing statistics
      recordTiming: true,
    });

    // Terminate worker threads when process receives exit signal
    this.terminatePoolHandler = () => {
      void this.pool.destroy();
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
    const controller = new AbortController();
    const promise = this.pool.run(args, {signal: controller.signal});

    this.tasks.push({controller, promise});
    promise.then(onDecrypted).catch(onError);
  }

  /**
   * Resolves once all queued tasks are completed and terminates worker threads.
   * Errors during executing can be captured in `onError` handler for each task.
   */
  async completed(): Promise<void> {
    // Wait for all tasks to settle (resolve or reject)
    await Promise.allSettled(this.tasks.map((t) => t.promise));
    await this.pool.close();
    this.signal.removeEventListener("abort", this.terminatePoolHandler);
  }

  /**
   * Cancel all pending tasks
   */
  cancel(): void {
    for (const task of this.tasks) {
      task.controller.abort();
    }
    this.tasks = [];
  }
}
