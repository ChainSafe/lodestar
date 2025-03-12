import path from "node:path";
import {defineConfig, mergeConfig} from "vitest/config";
const __dirname = new URL(".", import.meta.url).pathname;
import sharedConfig from "./vitest.config.base.js";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: process.env.CI === "true",
        clean: true,
        all: false,
        extension: [".ts"],
        provider: "v8",
        reporter: [["lcovonly", {file: "lcov.info"}], ["text"]],
        reportsDirectory: "./coverage",
        exclude: [
          "**/*.d.ts",
          "**/*.js",
          "**/lib/**",
          "**/coverage/**",
          "**/scripts/**",
          "**/test/**",
          "**/types/**",
          "**/bin/**",
          "**/node_modules/**",
          "**/spec-tests/**",
          "**/spec-tests-bls/**",
        ],
      },
      // There are some tests which are taking huge time
      // test/unit/chain/rewards/blockRewards.test.ts > chain / rewards / blockRewards > Normal case 73869ms
      // for now I tried to identify such tests an increase the limit a bit higher
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  })
);
