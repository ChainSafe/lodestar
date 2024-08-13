import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../vitest.base.unit.config";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
      typecheck: {
        // For some reason Vitest tries to run perf test files which causes an error
        // as we use Mocha for those. This ignores all errors outside of test files.
        ignoreSourceErrors: true,
      },
    },
  })
);
