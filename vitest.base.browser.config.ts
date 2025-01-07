import path from "node:path";
import {defineConfig} from "vitest/config";
const __dirname = new URL(".", import.meta.url).pathname;
import {nodePolyfills} from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import {blsBrowserPlugin} from "./scripts/vite/plugins/blsBrowserPlugin.js";

export default defineConfig({
  plugins: [
    topLevelAwait(),
    blsBrowserPlugin(),
    nodePolyfills({
      include: ["buffer", "process", "util", "string_decoder", "url", "querystring", "events"],
      globals: {Buffer: true, process: true},
      protocolImports: true,
    }),
    // TODO: Should be removed when the vite issue is fixed
    // https://github.com/vitest-dev/vitest/issues/6203#issuecomment-2245836028
    {
      name: "defineArgv",
      config() {
        return {
          define: {
            "process.argv": "[]",
            "process.nextTick": "function noop(){}",
          },
        };
      },
    },
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
    setupFiles: [path.join(__dirname, "./scripts/vitest/setupFiles/customMatchers.ts")],
    reporters: ["default", "hanging-process"],
    coverage: {
      enabled: false,
    },
    browser: {
      name: "chrome",
      headless: true,
      provider: "webdriverio",
      screenshotFailures: false,
      providerOptions: {
        capabilities: {
          browserVersion: "stable",
        },
      },
    },
  },
  resolve: {
    alias: {
      "node:perf_hooks": path.join(__dirname, "scripts/vitest/polyfills/perf_hooks.js"),
    },
  },
});
