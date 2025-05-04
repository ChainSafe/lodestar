import path from "node:path";
import {defineProject} from "vitest/config";

const setupFiles = [
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
];

export const constantsTestMinimalProject = defineProject({
  test: {
    name: "constants-minimal",
    include: ["**/test/constants/**/*.test.ts"],
    setupFiles,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "minimal",
    },
  },
});

export const constantsTestMainnetProject = defineProject({
  test: {
    name: "constants-mainnet",
    include: ["**/test/constants/**/*.test.ts"],
    setupFiles,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "mainnet",
    },
  },
});
