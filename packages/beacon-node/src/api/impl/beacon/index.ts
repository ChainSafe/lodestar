import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ApiModules} from "../types.js";
import {getBeaconBlockApi} from "./blocks/index.js";
import {getBeaconPoolApi} from "./pool/index.js";
import {getBeaconRewardsApi} from "./rewards/index.js";
import {getBeaconStateApi} from "./state/index.js";

export function getBeaconApi(
  modules: Pick<ApiModules, "chain" | "config" | "logger" | "metrics" | "network" | "db">
): ApplicationMethods<routes.beacon.Endpoints> {
  const block = getBeaconBlockApi(modules);
  const pool = getBeaconPoolApi(modules);
  const state = getBeaconStateApi(modules);
  const rewards = getBeaconRewardsApi(modules);

  const {chain, config, db} = modules;

  return {
    ...block,
    ...pool,
    ...state,
    ...rewards,

    async getGenesis() {
      return {
        data: {
          genesisForkVersion: config.GENESIS_FORK_VERSION,
          genesisTime: chain.genesisTime,
          genesisValidatorsRoot: chain.genesisValidatorsRoot,
        },
      };
    },

    async getDepositSnapshot() {
      const snapshot = await db.depositTreeSnapshot.lastValue();
      if (snapshot == null) {
        throw new Error("No deposit tree snapshot available");
      }

      return {
        data: snapshot,
      };
    },
  };
}
