import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../configs/vitest.config.base.e2e";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
    },
  })
);
