let defaultPoolSize: number;

try {
  if (typeof navigator !== "undefined") {
    defaultPoolSize = navigator.hardwareConcurrency ?? 4;
  } else {
    defaultPoolSize = (await import("node:os")).availableParallelism();
  }
} catch (_e) {
  defaultPoolSize = 8;
}

/**
 * Cross-platform aprox number of logical cores
 */
export {defaultPoolSize};
