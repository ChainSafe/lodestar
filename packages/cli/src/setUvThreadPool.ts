// Size the libuv threadpool to match available CPU cores.
// The native BLS verifier dispatches async work to libuv (via N-API), and the default
// pool size of 4 is far too small for BLS-heavy workloads. UV_THREADPOOL_SIZE is only
// read once by libuv before the first async I/O, so it must be set at the earliest
// entry point. Respect any explicit user override.

import {availableParallelism} from "node:os";

if (!process.env.UV_THREADPOOL_SIZE) {
  // Floor of 4 (libuv default) so we never reduce capacity for file I/O.
  // Ceiling of 32 for diminishing returns beyond that.
  const floor = 4;
  const ceiling = 32;
  // Subtract 1 to leave a core free for the main thread (event loop, etc).
  const size = Math.max(floor, Math.min(ceiling, availableParallelism() - 1));
  process.env.UV_THREADPOOL_SIZE = String(size);
}
