import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {ForkPostDeneb, ZERO_HASH_HEX, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
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

function toForkChoiceValidity(status: ExecutionStatus): "valid" | "invalid" | "optimistic" {
  switch (status) {
    case ExecutionStatus.Valid:
      return "valid";
    case ExecutionStatus.Invalid:
      return "invalid";
    case ExecutionStatus.Syncing:
    case ExecutionStatus.PreMerge:
      return "optimistic";
  }
}

function toPayloadStatusName(status: PayloadStatus): "pending" | "empty" | "full" {
  switch (status) {
    case PayloadStatus.PENDING:
      return "pending";
    case PayloadStatus.EMPTY:
      return "empty";
    case PayloadStatus.FULL:
      return "full";
  }
}

export function getDebugApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config" | "db">): ApplicationMethods<routes.debug.Endpoints> {
  return {
    async getDebugChainHeadsV2() {
      const heads = chain.beaconEngine.getHeads();
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
          justifiedCheckpoint: chain.beaconEngine.getJustifiedCheckpoint(),
          finalizedCheckpoint: chain.beaconEngine.getFinalizedCheckpoint(),
          forkChoiceNodes: chain.beaconEngine.getAllNodes().map((node) => ({
            slot: node.slot,
            blockRoot: node.blockRoot,
            parentRoot: node.parentRoot,
            justifiedEpoch: node.justifiedEpoch,
            finalizedEpoch: node.finalizedEpoch,
            weight: node.weight,
            validity: toForkChoiceValidity(node.executionStatus),
            executionBlockHash: node.executionPayloadBlockHash ?? ZERO_HASH_HEX,
          })),
        },
      };
    },

    async getDebugForkChoiceV2() {
      const {beaconEngine} = chain;
      return {
        data: {
          justifiedCheckpoint: beaconEngine.getJustifiedCheckpoint(),
          finalizedCheckpoint: beaconEngine.getFinalizedCheckpoint(),
          forkChoiceNodes: beaconEngine.getAllNodes().map((node) => {
            // Payload-specific fields apply only to a revealed Gloas payload = the FULL variant of a
            // Gloas block
            const ptc =
              node.payloadStatus === PayloadStatus.FULL ? beaconEngine.getPTCVoteCounts(node.blockRoot) : null;
            return {
              payloadStatus: toPayloadStatusName(node.payloadStatus),
              slot: node.slot,
              blockRoot: node.blockRoot,
              parentRoot: node.parentRoot,
              weight: node.weight,
              validity: toForkChoiceValidity(node.executionStatus),
              executionBlockHash: node.executionPayloadBlockHash ?? ZERO_HASH_HEX,
              extraData: {
                executionOptimistic: isOptimisticBlock(node),
                timestamp: computeTimeAtSlot(config, node.slot, chain.genesisTime),
                target: node.targetRoot,
                justifiedEpoch: node.justifiedEpoch,
                finalizedEpoch: node.finalizedEpoch,
                unrealizedJustifiedEpoch: node.unrealizedJustifiedEpoch,
                unrealizedFinalizedEpoch: node.unrealizedFinalizedEpoch,
                payloadAttesterCount: ptc?.attesterCount ?? null,
                payloadAvailabilityYesCount: ptc?.payloadPresentCount ?? null,
                payloadDataAvailabilityYesCount: ptc?.dataAvailableCount ?? null,
                gasLimit:
                  node.payloadStatus === PayloadStatus.FULL && "executionPayloadGasLimit" in node
                    ? node.executionPayloadGasLimit
                    : null,
              },
            };
          }),
          extraData: {
            unrealizedJustifiedCheckpoint: beaconEngine.getUnrealizedJustifiedCheckpoint(),
            unrealizedFinalizedCheckpoint: beaconEngine.getUnrealizedFinalizedCheckpoint(),
            proposerBoostRoot: beaconEngine.getProposerBoostRoot(),
            previousProposerBoostRoot: beaconEngine.getPreviousProposerBoostRoot(),
            headRoot: beaconEngine.getHeadRoot(),
          },
        },
      };
    },

    async getProtoArrayNodes() {
      const nodes = chain.beaconEngine.getAllNodes().map((node) => ({
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
      const id = resolveStateId(chain.beaconEngine, stateId);
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
