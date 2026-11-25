import path from "node:path";
import {defineProject} from "vitest/config";

const setupFiles = [
  path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
  path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
  path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
  path.join(__dirname, "../scripts/vitest/setupFiles/pubkeyCache.ts"),
];

// Sync tests wait on slot time and take as long as all other e2e tests combined,
// so they are their own project to let CI run them as a separate job.
const syncTests = "**/test/e2e/sync/**";

export const e2eMinimalProject = defineProject({
  test: {
    // Preferable over `e2e-mainnet` to speed up tests, only use `mainnet` preset in e2e tests
    // if absolutely required for interop testing, eg. in case of web3signer we need to use
    // `mainnet` preset to allow testing across multiple forks and ensure mainnet compatibility
    name: "e2e",
    include: ["**/test/e2e/**/*.test.ts"],
    exclude: [syncTests],
    setupFiles,
    env: {
      LODESTAR_PRESET: "minimal",
    },
    pool: "forks",
    maxWorkers: 1,
    isolate: true,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});

export const e2eSyncProject = defineProject({
  test: {
    name: "e2e-sync",
    include: [`${syncTests}/*.test.ts`],
    setupFiles,
    env: {
      LODESTAR_PRESET: "minimal",
    },
    pool: "forks",
    maxWorkers: 1,
    isolate: true,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});

export const e2eMainnetProject = defineProject({
  test: {
    // Currently only `e2e` tests for the `validator` package runs with the `mainnet` preset.
    name: "e2e-mainnet",
    include: ["**/test/e2e-mainnet/**/*.test.ts"],
    setupFiles,
    env: {
      LODESTAR_PRESET: "mainnet",
    },
    pool: "forks",
    maxWorkers: 1,
    isolate: true,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
