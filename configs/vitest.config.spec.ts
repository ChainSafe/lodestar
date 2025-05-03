import path from "node:path";
import {defineProject} from "vitest/config";

export const specProjectMinimal = defineProject({
  test: {
    name: "spec",
    include: ["**/test/spec/**/*.test.ts"],
    setupFiles: [
      path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    // There are tests which is taking over 10 minutes.
    //  ✓ test/spec/presets/epoch_processing.test.ts > electra/epoch_processing/rewards_and_penalties/pyspec_tests > electra/epoch_processing/rewards_and_penalties/pyspec_tests/full_attestations_one_validaor_one_gwei 572377ms
    // So I have to increase these values to such extreme
    testTimeout: 1000 * 60 * 15,
    hookTimeout: 1000 * 60 * 15,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "minimal",
    },
  },
});

export const specProjectMainnet = defineProject({
  test: {
    name: "spec-mainnet",
    include: ["**/test/spec/**/*.test.ts"],
    setupFiles: [
      path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/dotenv.ts"),
      path.join(__dirname, "../scripts/vitest/setupFiles/lodestarPreset.ts"),
    ],
    // There are tests which is taking over 10 minutes.
    //  ✓ test/spec/presets/epoch_processing.test.ts > electra/epoch_processing/rewards_and_penalties/pyspec_tests > electra/epoch_processing/rewards_and_penalties/pyspec_tests/full_attestations_one_validaor_one_gwei 572377ms
    // So I have to increase these values to such extreme
    testTimeout: 1000 * 60 * 15,
    hookTimeout: 1000 * 60 * 15,
    pool: "forks",
    env: {
      LODESTAR_PRESET: "mainnet",
    },
  },
});
