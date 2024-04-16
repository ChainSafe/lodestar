import path from "node:path";
import {UserConfig, ConfigEnv, Plugin} from "vite";

const __dirname = new URL(".", import.meta.url).pathname;
const polyfillsDir = path.join(__dirname, "../polyfills");

const emptyModulePath = path.join(__dirname, "../polyfills/emptyModule.js");

export function blsBrowserPlugin(): Plugin {
  return {
    name: "blsBrowserPlugin",
    config(_config: UserConfig, _env: ConfigEnv) {
      return {
        optimizeDeps: {
          exclude: ["@chainsafe/bls-keygen"],
          force: true,
        },
        resolve: {
          alias: {
            "@chainsafe/bls": "@chainsafe/bls/herumi",
            "@chainsafe/blst": emptyModulePath,
            "@chainsafe/bls-hd-key": emptyModulePath,
            "@chainsafe/bls-keygen": path.join(polyfillsDir, "bls-keygen.js"),
            // "@chainsafe/persistent-merkle-tree/lib/hasher/index": emptyModulePath,
            // "@chainsafe/persistent-merkle-tree": path.join(polyfillsDir, "persistent-merkle-tree.js"),
            crypto: emptyModulePath,
            "node:crypto": emptyModulePath,
            // "@chainsafe/bls/lib/blst-native"
          },
        },
      };
    },
  };
}
