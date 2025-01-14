let maxPoolSize: number;

try {
  if (typeof navigator !== "undefined") {
    maxPoolSize = navigator.hardwareConcurrency ?? 4;
  } else {
    maxPoolSize = (await import("node:os")).availableParallelism();
  }
} catch (_e) {
  maxPoolSize = 8;
}

/**
 * Cross-platform approx number of logical cores
 */
export {maxPoolSize};
