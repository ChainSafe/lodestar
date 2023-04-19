import {routes, ServerApi} from "@lodestar/api";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";

export function getDebugApi({
  chain,
  config,
  db,
}: Pick<ApiModules, "chain" | "config" | "db">): ServerApi<routes.debug.Api> {
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

    async getState(stateId: string | number, format?: routes.debug.StateFormat) {
      const {state} = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return state.serialize() as any;
      } else {
        return {data: state.toValue()};
      }
    },

    async getStateV2(stateId: string | number, format?: routes.debug.StateFormat) {
      const {state} = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
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
