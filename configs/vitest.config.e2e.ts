import path from "node:path";
import {defineProject} from "vitest/config";

export const e2eMinimalProject = defineProject({
  test: {
    // Preferable over `e2e-mainnet` to speed up tests, only use `mainnet` preset in e2e tests
    // if absolutely required for interop testing, eg. in case of web3signer we need to use
    // `mainnet` preset to allow testing across multiple forks and ensure mainnet compatibility
    name: "e2e",
    include: ["**/test/e2e/**/*.test.ts"],
    setupFiles: [
      path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    env: {
      LODESTAR_PRESET: "minimal",
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
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
    setupFiles: [
      path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    env: {
      LODESTAR_PRESET: "mainnet",
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
