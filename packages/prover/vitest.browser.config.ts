import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../vitest.base.browser.config";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
    },
  })
);
