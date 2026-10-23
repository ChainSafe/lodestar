import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ForkPostDeneb, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {BeaconState, DataColumnSidecar, DataColumnSidecars, type SignedBeaconBlock, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBlobKzgCommitments} from "../../../util/dataColumns.js";
import {isOptimisticBlock} from "../../../util/forkChoice.js";
import {getStateSlotFromBytes} from "../../../util/multifork.js";
import {getBlockResponse} from "../beacon/blocks/utils.js";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiError} from "../errors.js";
import {ApiModules} from "../types.js";
import {assertUniqueItems} from "../utils.js";

export function getDebugApi({
  chain,
  config,
  sync,
}: Pick<ApiModules, "chain" | "config" | "db" | "sync">): ApplicationMethods<routes.debug.Endpoints> {
  return {
    async getDebugChainHeadsV2() {
      const heads = await chain.beaconEngine.getHeads();
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
        data: await chain.beaconEngine.getDebugForkChoice(),
      };
    },

    async getDebugForkChoiceV2() {
      return {
        data: await chain.beaconEngine.getDebugForkChoiceV2(),
      };
    },

    async getProtoArrayNodes() {
      return {data: await chain.beaconEngine.getProtoArrayNodes()};
    },

    async getStateV2({stateId}, context) {
      const id = resolveStateId(chain.beaconEngine.chainView, stateId, chain, sync);
      const res = await chain.beaconEngine.getSerializedState(id);
      if (!res) {
        throw new ApiError(404, `State not found for id '${stateId}'`);
      }
      const {state: stateBytes, executionOptimistic, finalized} = res;
      const slot = getStateSlotFromBytes(stateBytes);
      // Whole-state debug endpoint: bytes are the payload; JSON path materializes the full state value.
      const data: Uint8Array | BeaconState = context?.returnBytes
        ? stateBytes
        : config.getForkTypes(slot).BeaconState.deserialize(stateBytes);
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
      const fork = config.getForkName(block.message.slot);
      const blockRoot = sszTypesFor(fork).BeaconBlock.hashTreeRoot(block.message);

      let dataColumnSidecars: DataColumnSidecar[];

      const blobCount = isForkPostDeneb(fork)
        ? getBlobKzgCommitments(fork, block as SignedBeaconBlock<ForkPostDeneb>).length
        : 0;

      if (isForkPostFulu(fork) && blobCount > 0) {
        dataColumnSidecars = await chain.getDataColumnSidecars(block.message.slot, toRootHex(blockRoot));

        if (dataColumnSidecars.length === 0) {
          throw Error(
            `dataColumnSidecars not found in db for slot=${block.message.slot} root=${toRootHex(blockRoot)} blobs=${blobCount}`
          );
        }
      } else {
        dataColumnSidecars = [];
      }

      return {
        data: (indices
          ? dataColumnSidecars.filter(({index}) => indices.includes(index))
          : dataColumnSidecars) as DataColumnSidecars,
        meta: {
          executionOptimistic,
          finalized,
          version: fork,
        },
      };
    },
  };
}
