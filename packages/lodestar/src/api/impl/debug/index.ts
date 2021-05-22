import {routes} from "@chainsafe/lodestar-api";
import {resolveStateId} from "../beacon/state/utils";
import {ApiModules} from "../types";

export function getDebugApi({chain, config, db}: Pick<ApiModules, "chain" | "config" | "db">): routes.debug.Api {
  return {
    async getHeads() {
      const heads = chain.forkChoice.getHeads();
      return {
        data: heads.map((blockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot})),
      };
    },

    async getState(stateId) {
      const state = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      return {data: state};
    },

    async getStateV2(stateId) {
      const state = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      return {data: state, version: config.getForkName(state.slot)};
    },
  };
}
