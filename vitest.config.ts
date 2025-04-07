import path from "node:path";
import {defineConfig} from "vitest/config";
import {browserTestProject} from "./configs/vitest.config.browser.js";
import {e2eMainnetProject, e2eProject} from "./configs/vitest.config.e2e.js";
import {specProjectMainnet, specProjectMinimal} from "./configs/vitest.config.spec.js";
import {typesTestProject} from "./configs/vitest.config.types.js";
import {unitTestMainnetProject, unitTestProject} from "./configs/vitest.config.unit.js";

export default defineConfig({
  test: {
    workspace: [
      {
        extends: true,
        ...unitTestProject,
      },
      {
        extends: true,
        ...unitTestMainnetProject,
      },
      {
        extends: true,
        ...browserTestProject,
      },
      {
        extends: true,
        ...e2eProject,
      },
      {
        extends: true,
        ...e2eMainnetProject,
      },
      {
        extends: true,
        ...specProjectMinimal,
      },
      {
        extends: true,
        ...specProjectMainnet,
      },
      {
        extends: true,
        ...typesTestProject,
      },
    ],
    exclude: [
      "**/spec-tests/**",
      "**/spec-tests-bls/**",
      "**/*.browser.test.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
    env: {
      NODE_ENV: "test",
    },
    clearMocks: true,
    // Some test files allocate a lot of data, which could cause more time for teardown
    teardownTimeout: 5_000,
    // We have a few spec tests suits (specially spec tests) which don't have individual tests
    passWithNoTests: true,
    reporters: process.env.GITHUB_ACTIONS
      ? ["verbose", "hanging-process", "github-actions"]
      : [process.env.TEST_COMPACT_OUTPUT ? "basic" : "verbose", "hanging-process"],
    diff: process.env.TEST_COMPACT_DIFF
      ? path.join(import.meta.dirname, "../scripts/vitest/vitest.diff.ts")
      : undefined,
    onConsoleLog: () => !process.env.TEST_QUIET_CONSOLE,
    coverage: {
      enabled: false,
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
  },
});
