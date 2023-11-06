import {routes, ServerApi, ResponseFormat} from "@lodestar/api";
import {allForks} from "@lodestar/types";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";

export function getDebugApi({chain, config}: Pick<ApiModules, "chain" | "config">): ServerApi<routes.debug.Api> {
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

    async getState(stateId: string | number, format?: ResponseFormat) {
      const {state} = await resolveStateId(chain, stateId, {allowRegen: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return state.serialize() as any;
      } else {
        return {data: state.toValue()};
      }
    },

    async getStateV2(stateId: string | number, format?: ResponseFormat) {
      const {state} = await resolveStateId(chain, stateId, {allowRegen: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        if (typeof state.serialize === "function") {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
          return state.serialize() as any;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return config.getForkTypes(state.slot).BeaconState.serialize(state as unknown as allForks.BeaconState) as any;
      } else {
        if (typeof state.toValue === "function") {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
          return state.toValue() as any;
        }
        return {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
          data: config.getForkTypes(state.slot).BeaconState.toJson(state as unknown as allForks.BeaconState),
          version: config.getForkName(state.slot),
        };
      }
    },
  };
}
