import {routes} from "@lodestar/api";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";
import {isOptimsticBlock} from "../../../util/forkChoice.js";

export function getDebugApi({chain, config, db}: Pick<ApiModules, "chain" | "config" | "db">): routes.debug.Api {
  return {
    async getDebugChainHeads() {
      const heads = chain.forkChoice.getHeads();
      return {
        data: heads.map((blockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot})),
      };
    },

    async getDebugChainHeadsV2() {
      const heads = chain.forkChoice.getHeads();
      return {
        data: heads.map((block) => ({
          slot: block.slot,
          root: block.blockRoot,
          executionOptimistic: isOptimsticBlock(block),
        })),
      };
    },

    async getState(stateId: string, format?: routes.debug.StateFormat) {
      const state = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return state.serialize() as any;
      } else {
        return {data: state.toValue()};
      }
    },

    async getStateV2(stateId: string, format?: routes.debug.StateFormat) {
      const state = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return state.serialize() as any;
      } else {
        return {data: state.toValue(), version: config.getForkName(state.slot)};
      }
    },
  };
}
