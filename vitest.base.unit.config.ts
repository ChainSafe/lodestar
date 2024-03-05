import path from "node:path";
import {defineConfig} from "vitest/config";
const __dirname = new URL(".", import.meta.url).pathname;

export default defineConfig({
  test: {
    pool: "threads",
    include: ["**/*.test.ts"],
    exclude: [
      "**/*.browser.test.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
    setupFiles: [
      path.join(__dirname, "./scripts/vitest/setupFiles/customMatchers.ts"),
      path.join(__dirname, "./scripts/vitest/setupFiles/dotenv.ts"),
    ],
    reporters: ["default", "hanging-process"],
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
      ],
    },
  },
});
