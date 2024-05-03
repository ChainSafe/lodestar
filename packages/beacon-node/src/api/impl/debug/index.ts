import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {phase0} from "@lodestar/types";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";

export function getDebugApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.debug.Endpoints> {
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
          executionOptimistic: isOptimisticBlock(block),
        })),
      };
    },

    async getProtoArrayNodes() {
      const nodes = chain.forkChoice.getAllNodes().map((node) => ({
        // if node has executionPayloadNumber, it will overwrite the below default
        executionPayloadNumber: 0,
        ...node,
        executionPayloadBlockHash: node.executionPayloadBlockHash ?? "",
        parent: String(node.parent),
        bestChild: String(node.bestChild),
        bestDescendant: String(node.bestDescendant),
      }));
      return {data: nodes};
    },

    async getState({stateId}, context = {}) {
      const {state, executionOptimistic, finalized} = await resolveStateId(chain, stateId, {allowRegen: true});
      return {
        data: context.returnBytes ? state.serialize() : (state.toValue() as phase0.BeaconState),
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateV2({stateId}, context = {}) {
      const {state, executionOptimistic, finalized} = await resolveStateId(chain, stateId, {allowRegen: true});
      return {
        data: context.returnBytes ? state.serialize() : state.toValue(),
        meta: {
          version: config.getForkName(state.slot),
          executionOptimistic,
          finalized,
        },
      };
    },
  };
}
