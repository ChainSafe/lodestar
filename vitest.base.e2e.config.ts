import path from "node:path";
import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "./vitest.base.unit.config.js";

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
    resolve: {
      alias: {
        "@chainsafe/blst": path.join(__dirname, "scripts/vitest/polyfills/emptyModule.js"),
      },
    },
  })
);
