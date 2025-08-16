import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {BeaconState} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {isOptimisticBlock} from "../../../util/forkChoice.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {getBlockResponse} from "../beacon/blocks/utils.js";
import {getStateResponseWithRegen} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";
import {assertUniqueItems} from "../utils.js";

export function getDebugApi({
  chain,
  config,
  db,
}: Pick<ApiModules, "chain" | "config" | "db">): ApplicationMethods<routes.debug.Endpoints> {
  return {
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

    async getDebugForkChoice() {
      return {
        data: {
          justifiedCheckpoint: chain.forkChoice.getJustifiedCheckpoint(),
          finalizedCheckpoint: chain.forkChoice.getFinalizedCheckpoint(),
          forkChoiceNodes: chain.forkChoice.getAllNodes().map((node) => ({
            slot: node.slot,
            blockRoot: node.blockRoot,
            parentRoot: node.parentRoot,
            justifiedEpoch: node.justifiedEpoch,
            finalizedEpoch: node.finalizedEpoch,
            weight: node.weight,
            validity: (() => {
              switch (node.executionStatus) {
                case ExecutionStatus.Valid:
                  return "valid";
                case ExecutionStatus.Invalid:
                  return "invalid";
                case ExecutionStatus.Syncing:
                case ExecutionStatus.PreMerge:
                  return "optimistic";
              }
            })(),
            executionBlockHash: node.executionPayloadBlockHash ?? ZERO_HASH_HEX,
          })),
        },
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

    async getStateV2({stateId}, context) {
      const {state, executionOptimistic, finalized} = await getStateResponseWithRegen(chain, stateId);
      let slot: number, data: Uint8Array | BeaconState;
      if (state instanceof Uint8Array) {
        slot = getStateSlotFromBytes(state);
        data = state;
      } else {
        slot = state.slot;
        data = context?.returnBytes ? state.serialize() : state.toValue();
      }
      return {
        data,
        meta: {
          version: config.getForkName(slot),
          executionOptimistic,
          finalized,
        },
      };
    },

    async getDebugDataColumnSidecars({blockId, indices}) {
      assertUniqueItems(indices, "Duplicate indices provided");

      const {block, executionOptimistic, finalized} = await getBlockResponse(chain, blockId);
      const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);

      let {dataColumnSidecars} = (await db.dataColumnSidecars.get(blockRoot)) ?? {};
      if (!dataColumnSidecars) {
        ({dataColumnSidecars} = (await db.dataColumnSidecarsArchive.get(block.message.slot)) ?? {});
      }

      if (!dataColumnSidecars) {
        throw Error(`dataColumnSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)}`);
      }

      return {
        data: indices ? dataColumnSidecars.filter(({index}) => indices.includes(index)) : dataColumnSidecars,
        meta: {
          executionOptimistic,
          finalized,
          version: config.getForkName(block.message.slot),
        },
      };
    },
  };
}
