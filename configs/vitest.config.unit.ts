import path from "node:path";
import {defineProject} from "vitest/config";

const setupFiles = [
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
  path.join(import.meta.dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
];

export const unitTestMinimalProject = defineProject({
  test: {
    name: "unit-minimal",
    include: ["**/test/unit-minimal/**/*.test.ts"],
    // TODO: We are using very old version of `@@ethereumjs/*` packages which are mixing up ESM and CJS with top-level-await
    // https://github.com/ChainSafe/lodestar/issues/8679
    exclude: [
      "**/web3_provider.node.test.ts",
      "**/verified_requests/eth_call.test.ts",
      "**/verified_requests/eth_estimateGas.test.ts",
    ],
    setupFiles,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "minimal",
    },
  },
});

export const unitTestMainnetProject = defineProject({
  test: {
    // Preferable over `unit-minimal` to test against mainnet fixtures/data, only use `minimal` preset in unit tests
    // if it significantly speeds up or simplifies test cases, eg. committee-based tests are a lot of the time easier
    // to write and faster when using `minimal` preset due to reduced committee size which lowers validator count required.
    name: "unit",
    include: ["**/test/unit/**/*.test.ts"],
    // TODO: We are using very old version of `@@ethereumjs/*` packages which are mixing up ESM and CJS with top-level-await
    // https://github.com/ChainSafe/lodestar/issues/8679
    exclude: [
      "**/web3_provider.node.test.ts",
      "**/verified_requests/eth_call.test.ts",
      "**/verified_requests/eth_estimateGas.test.ts",
    ],
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
