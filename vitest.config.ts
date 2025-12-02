import path from "node:path";
import {TestUserConfig, defineConfig} from "vitest/config";
import {browserTestProject} from "./configs/vitest.config.browser.js";
import {e2eMainnetProject, e2eMinimalProject} from "./configs/vitest.config.e2e.js";
import {specProjectMainnet, specProjectMinimal} from "./configs/vitest.config.spec.js";
import {typesTestProject} from "./configs/vitest.config.types.js";
import {unitTestMainnetProject, unitTestMinimalProject} from "./configs/vitest.config.unit.js";
import {esmCjsInteropPlugin} from "./scripts/vite/plugins/esmCjsInteropPlugin.js";

export function getReporters(): TestUserConfig["reporters"] {
  if (process.env.GITHUB_ACTIONS) return ["tree", "hanging-process", "github-actions"];
  if (process.env.TEST_COMPACT_OUTPUT) return ["basic", "hanging-process"];

  return ["tree", "hanging-process"];
}

export default defineConfig({
  plugins: [esmCjsInteropPlugin()],
  test: {
    projects: [
      {
        extends: true,
        ...unitTestMinimalProject,
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
        ...e2eMinimalProject,
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
    reporters: getReporters(),
    diff: process.env.TEST_COMPACT_DIFF
      ? path.join(import.meta.dirname, "../scripts/vitest/vitest.diff.ts")
      : undefined,
    onConsoleLog: () => !process.env.TEST_QUIET_CONSOLE,
    coverage: {
      enabled: false,
      include: ["packages/**/src/**.{ts}"],
      clean: true,
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
