import { createRequire } from "node:module";
import {UserConfig, ConfigEnv, Plugin} from "vite";

const require = createRequire(import.meta.url);
const prettyFormatCjsPath = require.resolve("../../../node_modules/pretty-format/build/index.js");

const isBun = "bun" in process.versions;

// This plugin is developed to overcome an esm resolution issue in Bun runtime. 
// TODO: Should remove this plugin when following issue is resolved
// https://github.com/oven-sh/bun/issues/24341
export function esmCjsInteropPlugin(): Plugin {
  return {
    name: "esmCjsInteropPlugin",
    config(_config: UserConfig, _env: ConfigEnv) {
      if(!isBun) return {};

      return {
        test: {
          server: {
            deps: {
              inline: ["pretty-format", "vitest-when"],
            },
          }
        },
        resolve: {
          alias: [{find: /^pretty-format$/, replacement: prettyFormatCjsPath}],
        },
      };
    },
};
}