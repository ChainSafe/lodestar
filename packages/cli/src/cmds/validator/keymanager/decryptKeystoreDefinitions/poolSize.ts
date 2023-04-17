import os from "node:os";

/**
 * Amount of memory used to decrypt a single keystore
 * calculated from https://github.com/ethereum/staking-deposit-cli/blob/d7b530442d6e0921c9db84b3a1cf6b3ecd6b9d35/staking_deposit/key_handling/keystore.py#L190-L195
 */
export const KEYSTORE_MEMORY_USAGE = 268435456;
/**
 * Maximum amount of memory to use per thread
 * conservatively, 2GB
 */
export const MAX_MEMORY_USAGE_PER_THREAD = 2147483648;

export const MAX_CONCURRENCY_PER_THREAD = Math.floor(MAX_MEMORY_USAGE_PER_THREAD / KEYSTORE_MEMORY_USAGE);

/**
 * Figure out what the best combination of workers and job concurrency is to best utilize available memory
 */
export function calculateThreadpoolConcurrency(): {numWorkers: number; jobConcurrency: number} {
  const defaultPoolSize = os.cpus().length;
  // Don't eat all available memory
  const freeMem = os.freemem() * 0.8;
  let numWorkers = defaultPoolSize;
  let jobConcurrency = 1;
  for (let i = defaultPoolSize; i > 0; i--) {
    const iConcurrency = Math.floor(freeMem / i / KEYSTORE_MEMORY_USAGE);
    if (iConcurrency <= MAX_CONCURRENCY_PER_THREAD && iConcurrency > jobConcurrency) {
      numWorkers = i;
      jobConcurrency = iConcurrency;
    }
  }
  return {
    numWorkers,
    jobConcurrency,
  };
}
