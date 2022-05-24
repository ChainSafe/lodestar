import {routes} from "@chainsafe/lodestar-api";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {ApiModules} from "../types.js";
import {getBeaconBlockApi} from "./blocks/index.js";
import {getBeaconPoolApi} from "./pool/index.js";
import {getBeaconStateApi} from "./state/index.js";

export function getBeaconApi(
  modules: Pick<ApiModules, "chain" | "config" | "logger" | "metrics" | "network" | "db">
): routes.beacon.Api {
  const block = getBeaconBlockApi(modules);
  const pool = getBeaconPoolApi(modules);
  const state = getBeaconStateApi(modules);

  const {chain, config} = modules;

  return {
    ...block,
    ...pool,
    ...state,

    async getGenesis() {
      const genesisForkVersion = config.getForkVersion(GENESIS_SLOT);
      return {
        data: {
          genesisForkVersion,
          genesisTime: chain.genesisTime,
          genesisValidatorsRoot: chain.genesisValidatorsRoot,
        },
      };
    },
  };
}
