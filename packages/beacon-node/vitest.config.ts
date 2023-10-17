import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../vitest.base.config";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
    },
  })
);
