import os from "node:os";

/**
 * Sets the libuv thread pool size for worker threads.  This is a critical
 * component for effective node operations.  Setting the environment variable
 * must happen almost at the beginning of startup, BEFORE the worker pool is
 * created by libuv.
 *
 * The trigger for creation of the libuv worker pool is scheduling async work
 * that will queue for a worker.  An example of things that can trigger that
 * condition are async reading files from the OS.  Some network operations and
 * any native modules that utilize async work (like @chainsafe/blst-ts).
 *
 * Setting this value higher than the number of cores will not be a benefit
 * because the kernel will need to do context switching to parallelize the work
 * on a number of cores that is less than the number of requested threads.
 *
 * Setting this number lower than then number of cores will reduce the amount of
 * bls work that can be concurrently done.  Something like 70% of the work the
 * cpu does to keep up with the chain is blst validation.
 *
 * There is a considerable amount of idle process time on both the main thread
 * and network thread and setting this value to overlap that work will allow the
 * kernel to utilize the idle time for additional bls verification.
 *
 * Empirical testing has shown that sizing the worker pool to be as large as
 * the number of logical cores is optimal but this may change in the future.
 */
export function setThreadPoolSize(): void {
  process.env.UV_THREADPOOL_SIZE = os.availableParallelism().toString();
}
