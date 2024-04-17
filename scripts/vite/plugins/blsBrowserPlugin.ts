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
            "@chainsafe/bls/types": "@chainsafe/bls/types",
            "@chainsafe/bls": "@chainsafe/bls/herumi",
            // This is just used to generate `privateKey` which is not used in the browser.
            "@chainsafe/bls-keygen": path.join(polyfillsDir, "bls-keygen.js"),
            "@chainsafe/blst": emptyModulePath,
            "@chainsafe/bls-hd-key": emptyModulePath,
            crypto: emptyModulePath,
            "node:crypto": emptyModulePath,
          },
        },
      };
    },
  };
}
