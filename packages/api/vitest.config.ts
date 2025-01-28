import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../configs/vitest.base.unit.config";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
      restoreMocks: true,
    },
  })
);
