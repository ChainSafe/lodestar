import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {isForkPostGloas} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
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
      // Preferences are broadcast up to one epoch ahead of their proposal slot, the first ones before Gloas is active
      const fork = config.getForkName(slot ?? computeStartSlotAtEpoch(chain.clock.currentEpoch + 1));
      if (!isForkPostGloas(fork)) {
        throw new ApiError(400, `Proposer preferences are not supported before Gloas fork=${fork}`);
      }

      return {data: chain.proposerPreferencesPool.getAll(slot), meta: {version: fork}};
    },
  };
}
