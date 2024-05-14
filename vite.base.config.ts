import {UserConfig, defineConfig} from "vite";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import {visualizer} from "rollup-plugin-visualizer";
import topLevelAwait from "vite-plugin-top-level-await";
import {blsBrowserPlugin} from "./scripts/vite/plugins/blsBrowserPlugin.js";

export function getBaseViteConfig(
  pkgInfo: {
    description: string;
    version: string;
    author: string;
    license: string;
    homepage: string;
  },
  {entry, libName}: {entry: string; libName: string}
): UserConfig {
  // TODO: Investigate why this banner is not appended to the build header.
  const banner =
    `/* ${pkgInfo.description}\n` +
    " * \n" +
    ` * Version: ${pkgInfo.version}\n` +
    ` * Author: ${pkgInfo.author}\n` +
    ` * License: ${pkgInfo.license}\n` +
    ` * Web: ${pkgInfo.homepage}\n` +
    "*/";

  return defineConfig({
    plugins: [
      topLevelAwait(),
      blsBrowserPlugin(),
      nodePolyfills({
        include: ["http", "https", "stream"],
        globals: {Buffer: true, process: true},
        protocolImports: true,
      }),
      ...(process.env.DEBUG_BUNDLE ? [visualizer()] : []),
    ],
    mode: "production",
    appType: "custom",
    esbuild: {
      banner,
      legalComments: "none",
      sourcemap: "inline",
    },
    build: {
      // "modules" refer to ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
      target: "modules",
      outDir: "dist",
      sourcemap: true,
      minify: true,
      manifest: "manifest.json",
      ssr: false,
      ssrManifest: false,
      emptyOutDir: true,
      lib: {
        entry,
        formats: ["es"],
        name: libName,
        fileName: (format) => {
          if (format === "esm" || format === "es") {
            return `${libName.toLowerCase()}.min.mjs`;
          } else if (format === "cjs") {
            return `${libName.toLowerCase()}.min.cjs`;
          } else {
            return `${libName.toLowerCase()}.min.${format}.js`;
          }
        },
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
        treeshake: {
          preset: "recommended",
        },
      },
    },
  });
}
