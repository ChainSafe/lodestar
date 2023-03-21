import {routes, ServerApi} from "@lodestar/api";
import {ApiModules} from "../types.js";
import {getBeaconBlockApi} from "./blocks/index.js";
import {getBeaconPoolApi} from "./pool/index.js";
import {getBeaconStateApi} from "./state/index.js";

export function getBeaconApi(
  modules: Pick<ApiModules, "chain" | "config" | "logger" | "metrics" | "network" | "db">
): ServerApi<routes.beacon.Api> {
  const block = getBeaconBlockApi(modules);
  const pool = getBeaconPoolApi(modules);
  const state = getBeaconStateApi(modules);

  const {chain, config} = modules;

  return {
    ...block,
    ...pool,
    ...state,

    async getGenesis() {
      return {
        data: {
          genesisForkVersion: config.GENESIS_FORK_VERSION,
          genesisTime: chain.genesisTime,
          genesisValidatorsRoot: chain.genesisValidatorsRoot,
        },
      };
    },
  };
}
