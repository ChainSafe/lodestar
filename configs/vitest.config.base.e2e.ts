import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "./vitest.config.base.unit.js";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: false,
      },
      pool: "forks",
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
    },
  })
);
