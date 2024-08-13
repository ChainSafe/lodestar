import path from "node:path";
import fs from "node:fs";
import {defineConfig, mergeConfig} from "vite";
import dts from "vite-plugin-dts";
import {getBaseViteConfig} from "../../vite.base.config.js";

import pkgJSON from "./package.json";

export default mergeConfig(
  getBaseViteConfig(pkgJSON, {libName: "LightClient", entry: "src/index.ts"}),
  defineConfig({
    plugins: [
      dts({
        rollupTypes: true,
        bundledPackages: ["@lodestar/*", "@chainsafe/persistent-merkle-tree", "@chainsafe/bls", "@chainsafe/ssz"],
        afterBuild() {
          fs.renameSync(
            path.join(import.meta.dirname, "dist", "index.d.ts"),
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
