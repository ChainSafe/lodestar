import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    reporters: ["default", "hanging-process"],
    coverage: {
      clean: true,
      provider: "v8",
      reporter: [["lcovonly", {projectRoot: "./src", file: "lcov.info"}], ["json", {file: "coverage.json"}], ["text"]],
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
      ],
    },
  },
});
