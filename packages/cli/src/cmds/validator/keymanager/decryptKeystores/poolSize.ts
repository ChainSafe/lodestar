let maxPoolSize: number;

try {
  if (typeof navigator !== "undefined") {
    maxPoolSize = navigator.hardwareConcurrency ?? 4;
  } else {
    // TODO change this line to use os.availableParallelism() once we upgrade to node v20
    maxPoolSize = (await import("node:os")).cpus().length;
  }
} catch (e) {
  maxPoolSize = 8;
}

/**
 * Cross-platform approx number of logical cores
 */
export {maxPoolSize};
