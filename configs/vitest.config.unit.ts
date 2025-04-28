import path from "node:path";
import {defineProject} from "vitest/config";

const setupFiles = [
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
];

export const unitTestProject = defineProject({
  test: {
    name: "unit",
    include: ["**/test/unit/**/*.test.ts"],
    setupFiles,
    // There are some tests which are taking huge time
    // test/unit/chain/rewards/blockRewards.test.ts > chain / rewards / blockRewards > Normal case 73869ms
    // for now I tried to identify such tests an increase the limit a bit higher
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "minimal",
    },
  },
});

export const unitTestMainnetProject = defineProject({
  test: {
    name: "unit-mainnet",
    include: ["**/test/unit-mainnet/**/*.test.ts"],
    setupFiles,
    // There are some tests which are taking huge time
    // test/unit/chain/rewards/blockRewards.test.ts > chain / rewards / blockRewards > Normal case 73869ms
    // for now I tried to identify such tests an increase the limit a bit higher
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "mainnet",
    },
  },
});
