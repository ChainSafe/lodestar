/* eslint-disable import/no-extraneous-dependencies */
import {UserConfig, ConfigEnv, Plugin} from "vite";

export function buildTargetPlugin(target: string): Plugin {
  return {
    name: "buildTargetPlugin",
    config(_config: UserConfig, _env: ConfigEnv) {
      return {
        esbuild: {
          target,
        },
      };
    },
  };
}
