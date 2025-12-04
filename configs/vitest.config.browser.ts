import path from "node:path";
import {playwright} from "@vitest/browser-playwright";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import {defineProject} from "vitest/config";
import {blsBrowserPlugin} from "../scripts/vite/plugins/blsBrowserPlugin.js";

const isBun = "bun" in process.versions;

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
      provider: playwright(),
      connectTimeout: 90_0000,
      instances: [
        // TODO: Add support for webkit when available
        {
          browser: "firefox",
          maxConcurrency: 1,
        },
        {
          browser: "chromium",
          maxConcurrency: 1,
        },
      ],
    },
  },
  plugins: [
    // Bun does allow commonjs to be in pipeline and `vite-plugin-top-level-await` is using it
    // So we convert it to the dynamic import so bun unit tests does not load these
    // when the `import` called on top of the config file
    ...(isBun ? [] : [import("vite-plugin-top-level-await").then((p) => p.default())]),
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
