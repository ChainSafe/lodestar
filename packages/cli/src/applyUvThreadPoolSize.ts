// MUST import this file before anything that uses libuv's thread pool: libuv reads its size once,
// when the pool is first used, and ignores a later change.

import os from "node:os";

// A validator client signs leanXMSS signatures on libuv's pool, as many at once as it has threads,
// and its default is 4 whatever the number of CPUs.
if (process.argv[2] === "validator" && process.env.UV_THREADPOOL_SIZE === undefined) {
  process.env.UV_THREADPOOL_SIZE = String(os.availableParallelism());
}
