// Size the libuv threadpool for native async I/O that still uses libuv.
// BLS verification uses lodestar-z's dedicated worker pool, so UV_THREADPOOL_SIZE
// is no longer a BLS sizing knob. It is still read once by libuv before the first
// async I/O, so keep this at the earliest entry point and respect user overrides.

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
