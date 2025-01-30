import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../configs/vitest.config.base.browser";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
    }
  })
);
