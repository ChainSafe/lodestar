import path from "node:path";
import {defineConfig, mergeConfig} from "vitest/config";
import vitestConfig from "../../vitest.base.browser.config";

const __dirname = new URL(".", import.meta.url).pathname;

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/globalSetup.ts"],
      environment: path.join(__dirname, "../../scripts/vitest/sesEnvironment.ts"),
      environmentOptions: {
        custom: {
          option: "config-option",
        },
      },
    },
  })
);
