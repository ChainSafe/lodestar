import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../configs/vitest.base.browser.config";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
    },
    optimizeDeps: {
      exclude: ["@chainsafe/blst"],
    },
  })
);
