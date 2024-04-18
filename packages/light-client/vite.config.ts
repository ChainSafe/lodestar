import path from "node:path";
import fs from "node:fs/promises";
import {defineConfig, mergeConfig} from "vite";
import dts from "vite-plugin-dts";
import {getBaseViteConfig} from "../../vite.base.config.js";

import pkgJSON from "./package.json";

export default mergeConfig(
  getBaseViteConfig(pkgJSON, {libName: "LightClient", entry: "src/index.ts"}),
  defineConfig({
    plugins: [
      dts({
        entryRoot: "src",
        // It would be better to rollup all types into one file, But the current package.json.types field
        // is pointing to other file that conflict with the entry file for bundle. If we decide to use one
        // entry file for both package and bundle then this issue could be resolved
        //
        rollupTypes: false,
        bundledPackages: ["@lodestar/*", "@chainsafe/*"],
        exclude: ["test/**/*", "*.config.ts"],
        async afterBuild() {
          await fs.rename(
            path.join(import.meta.dirname, "dist", "index.browser.d.ts"),
            path.join(import.meta.dirname, "dist", "lightclient.min.d.mts")
          );
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          footer: `
        globalThis.lodestar = globalThis.lodestar === undefined ? {} : globalThis.lodestar;
        globalThis.lodestar.lightclient = {
          Lightclient,
          LightclientEvent,
          RunStatusCode,
          upgradeLightClientFinalityUpdate,
          upgradeLightClientOptimisticUpdate,
          utils,
          transport,
          validation
        };
        `,
        },
      },
    },
  })
);
