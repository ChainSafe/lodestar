let defaultPoolSize: number;

try {
  if (typeof navigator !== "undefined") {
    defaultPoolSize = navigator.hardwareConcurrency ?? 4;
  } else {
    defaultPoolSize = (await import("node:os")).cpus().length;
  }
} catch (e) {
  defaultPoolSize = 8;
}

// TODO: get this from environment variable
const libuvThreadpoolSize = 4;
// 1 cpu is reserved for the main thread
defaultPoolSize = Math.max(4, defaultPoolSize - libuvThreadpoolSize - 1);

/**
 * Cross-platform aprox number of logical cores
 */
export {defaultPoolSize};
