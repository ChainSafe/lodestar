import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "./vitest.config.base.unit.js";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: false,
      },
      // There are tests which is taking over 10 minutes.
      //  ✓ test/spec/presets/epoch_processing.test.ts > electra/epoch_processing/rewards_and_penalties/pyspec_tests > electra/epoch_processing/rewards_and_penalties/pyspec_tests/full_attestations_one_validaor_one_gwei 572377ms
      // So I have to increase these values to such extreme
      testTimeout: 1000 * 60 * 15,
      hookTimeout: 1000 * 60 * 15,
      passWithNoTests: true,
      pool: "threads",
      poolOptions: {
        threads: {
          isolate: false,
        },
      },
    },
  })
);
