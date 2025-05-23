/// <reference types="@vitest/browser/providers/webdriverio" />

import path from "node:path";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import {defineProject} from "vitest/config";
import {blsBrowserPlugin} from "../scripts/vite/plugins/blsBrowserPlugin.js";

export const browserTestProject = defineProject({
  test: {
    name: "browser",
    include: ["**/test/browser/**/*.test.ts"],
    exclude: ["**/*.node.test.ts"],
    setupFiles: [path.join(import.meta.dirname, "../scripts/vitest/setupFiles/customMatchers.ts")],
    env: {
      LODESTAR_PRESET: "mainnet",
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
  plugins: [
    topLevelAwait(),
    blsBrowserPlugin(),
    nodePolyfills({
      include: ["buffer", "process", "util", "string_decoder", "url", "querystring", "events"],
      globals: {Buffer: true, process: true},
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      "node:perf_hooks": path.join(import.meta.dirname, "../scripts/vitest/polyfills/perf_hooks.js"),
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
