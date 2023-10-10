import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    reporters: ["default", "hanging-process"],
    coverage: {
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
      ],
    },
  },
});
