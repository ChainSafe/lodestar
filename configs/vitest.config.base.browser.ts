/// <reference types="@vitest/browser/providers/webdriverio" />

import path from "node:path";
import {defineConfig} from "vitest/config";
const __dirname = new URL(".", import.meta.url).pathname;
import {nodePolyfills} from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import {blsBrowserPlugin} from "../scripts/vite/plugins/blsBrowserPlugin.js";

export default defineConfig({
  plugins: [
    topLevelAwait(),
    blsBrowserPlugin(),
    nodePolyfills({
      include: ["buffer", "process", "util", "string_decoder", "url", "querystring", "events"],
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
    setupFiles: [path.join(__dirname, "../scripts/vitest/setupFiles/customMatchers.ts")],
    reporters: ["default", "hanging-process"],
    coverage: {
      enabled: false,
    },
    browser: {
      enabled: true,
      headless: true,
      ui: false,
      screenshotFailures: false,
      // Recommended provider is `playwright` but it's causing following error on CI
      // Error: Failed to connect to the browser session "af5be85a-7f29-4299-b680-b07f0cfc2520" within the timeout.
      // TODO: Debug the issue in later versions of playwright and vitest
      provider: "webdriverio",
      connectTimeout: 90_0000,
      instances: [
        // TODO: Add support for webkit when available
        // Invalid types from webdriverio for capabilities
        {
          browser: "firefox",
          maxConcurrency: 1,
          capabilities: {
            browserVersion: "stable",
          },
        } as never,
        // Invalid types from webdriverio for capabilities
        {
          browser: "chrome",
          maxConcurrency: 1,
          capabilities: {
            browserVersion: "stable",
          },
        } as never,
      ],
    },
  },
  resolve: {
    alias: {
      "node:perf_hooks": path.join(__dirname, "../scripts/vitest/polyfills/perf_hooks.js"),
    },
  },
  optimizeDeps: {
    include: [
      "vite-plugin-node-polyfills/shims/buffer",
      "vite-plugin-node-polyfills/shims/global",
      "vite-plugin-node-polyfills/shims/process",
    ],
  },
});
