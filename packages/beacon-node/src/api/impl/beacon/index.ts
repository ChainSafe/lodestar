import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {isForkPostGloas} from "@lodestar/params";
import {ApiError} from "../errors.js";
import {ApiModules} from "../types.js";
import {getBeaconBlockApi} from "./blocks/index.js";
import {getBeaconPoolApi} from "./pool/index.js";
import {getBeaconRewardsApi} from "./rewards/index.js";
import {getBeaconStateApi} from "./state/index.js";

export function getBeaconApi(
  modules: Pick<ApiModules, "chain" | "config" | "logger" | "metrics" | "network" | "db" | "sync">
): ApplicationMethods<routes.beacon.Endpoints> {
  const block = getBeaconBlockApi(modules);
  const pool = getBeaconPoolApi(modules);
  const state = getBeaconStateApi(modules);
  const rewards = getBeaconRewardsApi(modules);

  const {chain, config} = modules;

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

    async getProposerPreferences({slot}) {
      const fork = config.getForkName(slot ?? chain.clock.currentSlot);
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `Proposer preferences are not supported before Gloas fork=${fork}`);
      }

      return {data: chain.proposerPreferencesPool.getAll(slot), meta: {version: fork}};
    },
  };
}
