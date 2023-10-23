import path from "node:path";
import {defineConfig} from "vitest/config";
const __dirname = new URL(".", import.meta.url).pathname;
import {nodePolyfills} from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [
    topLevelAwait(),
    nodePolyfills({
      include: ["buffer", "process", "util", "string_decoder", "url", "querystring"],
      globals: {Buffer: true, process: true},
      protocolImports: true,
    }),
  ],
  test: {
    include: ["**/*.test.ts"],
    exclude: [
      "**/*.node.test.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/lib/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
    setupFiles: [path.join(__dirname, "./scripts/vitest/customMatchers.ts")],
    reporters: ["default", "hanging-process"],
    coverage: {
      enabled: false,
    },
    browser: {
      name: "chrome",
      headless: true,
      provider: "webdriverio",
      slowHijackESM: false,
    },
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "node:perf_hooks": path.join(__dirname, "scripts/vitest/polyfills/perf_hooks.js"),
      events: "eventemitter3",
    },
  },
});
