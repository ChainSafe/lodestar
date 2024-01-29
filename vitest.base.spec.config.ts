import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "./vitest.base.unit.config.js";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: false,
      },
      testTimeout: 60_000,
      hookTimeout: 60_000,
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
