import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../configs/vitest.config.base.unit";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"]
    },
  })
);
