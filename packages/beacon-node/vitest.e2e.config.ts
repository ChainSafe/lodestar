import {defineConfig, mergeConfig} from "vitest/config";
import {buildTargetPlugin} from "../../scripts/vite/plugins/buildTargetPlugin";
import vitestConfig from "../../vitest.base.e2e.config";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    // We need to change the build target to test code which is based on `using` keyword
    // Note this target is not fully supported for the browsers
    plugins: [buildTargetPlugin("es2022")],
    test: {
      globalSetup: ["./test/globalSetup.ts"],
    },
  })
);
