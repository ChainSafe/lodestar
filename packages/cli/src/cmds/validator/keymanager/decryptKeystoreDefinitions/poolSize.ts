let defaultPoolSize: number;

try {
  if (typeof navigator !== "undefined") {
    defaultPoolSize = navigator.hardwareConcurrency ?? 4;
  } else {
    // TODO change this line to use os.availableParallelism() once we upgrade to node v20
    defaultPoolSize = (await import("node:os")).cpus().length;
  }
} catch (e) {
  defaultPoolSize = 8;
}

/**
 * Cross-platform aprox number of logical cores
 */
export {defaultPoolSize};
