import {defineConfig} from "vite";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import {visualizer} from "rollup-plugin-visualizer";
import {blsBrowserPlugin} from "../../scripts/vite/plugins/blsBrowserPlugin.js";

import pkgJSON from "./package.json";

// TODO: Investigate why this banner is not appended to the build header.
const banner =
  `/* ${pkgJSON.description}\n` +
  " * \n" +
  ` * Version: ${pkgJSON.version}\n` +
  ` * Author: ${pkgJSON.author}\n` +
  ` * License: ${pkgJSON.license}\n` +
  ` * Web: ${pkgJSON.homepage}\n` +
  "*/";

export default defineConfig({
  plugins: [
    topLevelAwait(),
    blsBrowserPlugin(),
    nodePolyfills({
      include: ["http", "https", "stream"],
      globals: {Buffer: true, process: true},
      protocolImports: true,
    }),
    ...(process.env.CI ? [] : [visualizer()]),
  ],
  mode: "production",
  appType: "custom",
  esbuild: {
    banner,
    legalComments: "none",
  },
  build: {
    // "modules" refer to ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
    target: "modules",
    outDir: "dist",
    sourcemap: true,
    minify: false,
    manifest: "manifest.json",
    ssr: false,
    ssrManifest: false,
    emptyOutDir: true,
    lib: {
      entry: "src/index.browser.ts",
      formats: ["es"],
      name: "LightClient",
      fileName: (format) => {
        if (format === "esm" || format === "es") {
          return "lightclient.min.mjs";
        } else if (format === "cjs") {
          return "lightclient.min.cjs";
        } else {
          return `lightclient.min.${format}.js`;
        }
      },
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        footer: `
        globalThis.lodestar = globalThis.lodestar === undefined ? {} : globalThis.lodestar;
        globalThis.lodestar.lightclient = {
          Lightclient,
          LightclientEvent,
          RunStatusCode,
          upgradeLightClientFinalityUpdate,
          upgradeLightClientOptimisticUpdate,
          utils: index$1,
          transport: index,
          validation
        };
        `,
      },
      treeshake: {
        preset: "recommended",
      },
    },
  },
});
