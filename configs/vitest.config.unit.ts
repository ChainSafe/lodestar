import path from "node:path";
import {defineProject, mergeConfig} from "vitest/config";

export const unitTestProject = defineProject({
  test: {
    name: "unit",
    include: ["**/test/unit/**/*.test.ts"],
    setupFiles: [
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(import.meta.dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    // There are some tests which are taking huge time
    // test/unit/chain/rewards/blockRewards.test.ts > chain / rewards / blockRewards > Normal case 73869ms
    // for now I tried to identify such tests an increase the limit a bit higher
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

export const unitTestMainnetProject = mergeConfig(
  unitTestProject,
  defineProject({
    test: {
      name: "unit-mainnet",
      include: ["**/test/unit-mainnet/**/*.test.ts"],
      env: {
        LODESTAR_PRESET: "mainnet",
      },
    },
  })
);

export const unitTestConstantsProject = mergeConfig(
  unitTestProject,
  defineProject({
    test: {
      name: "constants",
      include: ["**/test/constants/**/*.test.ts"],
    },
  })
);

export const unitTestConstantsMainnetProject = mergeConfig(
  unitTestProject,
  defineProject({
    test: {
      name: "constants-mainnet",
      include: ["**/test/constants/**/*.test.ts"],
      env: {
        LODESTAR_PRESET: "mainnet",
      },
    },
  })
);
