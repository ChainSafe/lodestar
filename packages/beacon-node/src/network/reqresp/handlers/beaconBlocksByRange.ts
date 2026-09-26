import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {GENESIS_SLOT, isForkPostDeneb} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {deneb, phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ServingCapacityError, ServingContext, assertServableBlock} from "../../../chain/serving/context.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.js";

// TODO: Unit test

export async function* onBeaconBlocksByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string,
  context?: ServingContext
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateBeaconBlocksByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  const finalized = db.blockArchive;
  // in the case of initializing from a non-finalized state, we don't have the finalized block so this api does not work
  // chain.forkChoice.getFinalizeBlock().slot
  const finalizedSlot = chain.forkChoice.getFinalizedCheckpointSlot();
  // Blocks are migrated to blockArchive at finalization (including the finalized block itself),
  // so the archive loop serves up to AND INCLUDING finalizedSlot and the headChain loop
  // starts above it to avoid duplicate yields. See archiveBlocks.ts for the migration logic.
  const archiveMaxSlot = finalizedSlot;

  // endSlot is exclusive, so highest served slot is endSlot - 1.
  // Throw only when the entire requested range is below earliestAvailableSlot.
  if (endSlot - 1 < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer requested range before earliestAvailableSlot for BeaconBlocksByRange", {
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
      startSlot,
      count,
      earliestAvailableSlot: chain.earliestAvailableSlot,
    });
    throw new ResponseError(
      RespStatus.RESOURCE_UNAVAILABLE,
      `Requested range is before earliestAvailableSlot startSlot=${startSlot} count=${count} earliestAvailableSlot=${chain.earliestAvailableSlot}`
    );
  }

  // A range with any block not certified to fit MAX_PAYLOAD_SIZE is refused before its first read
  const {blockCertification} = db;
  assertServableBlock(
    context,
    (startSlot > archiveMaxSlot ||
      blockCertification.isArchiveRangeVerified(startSlot, Math.min(endSlot, archiveMaxSlot + 1) - 1)) &&
      (endSlot <= archiveMaxSlot + 1 || blockCertification.hotVerified)
  );

  // Finalized range of blocks
  if (startSlot <= archiveMaxSlot) {
    // Chain of blobs won't change
    for await (const {key, value} of finalized.binaryEntriesStream({
      ...(context ? {...context.streamOptions(), limit: count} : {}),
      gte: startSlot,
      lt: Math.min(endSlot, archiveMaxSlot + 1),
    })) {
      context?.checkResponse(value, context.limits.blockBytes);
      yield {
        data: value,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(finalized.decodeKey(key))),
      };
    }
  }

  // Non-finalized range of blocks
  if (endSlot > archiveMaxSlot) {
    const headChain = collectServingHeadRange(chain, startSlot, endSlot, archiveMaxSlot, context);
    for (const block of headChain) {
      // Must include only blocks in the range requested, and skip anything the archive loop
      // above already served via the block.slot > archiveMaxSlot filter.
      if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // after the archive reads. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blockBytes = await chain.getSerializedBlockByRoot(block.blockRoot, context);
        if (!blockBytes) {
          throw new ResponseError(
            RespStatus.SERVER_ERROR,
            `No block for root ${block.blockRoot} slot ${block.slot}, startSlot=${startSlot} endSlot=${endSlot} finalizedSlot=${finalizedSlot}`
          );
        }

        yield {
          data: blockBytes.block,
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
        };
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}

export function validateBeaconBlocksByRangeRequest(
  config: BeaconConfig,
  request: phase0.BeaconBlocksByRangeRequest
): deneb.BlobSidecarsByRangeRequest {
  const {startSlot} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // The phase0 req/resp spec uses MIN_EPOCHS_FOR_BLOCK_REQUESTS to define the minimum range peers MUST serve.
  // Archival nodes may still serve older retained blocks to allow genesis sync.

  // step > 1 is deprecated, see https://github.com/ethereum/consensus-specs/pull/2856

  const maxRequestBlocks = isForkPostDeneb(config.getForkName(startSlot))
    ? config.MAX_REQUEST_BLOCKS_DENEB
    : config.MAX_REQUEST_BLOCKS;

  if (count > maxRequestBlocks) {
    count = maxRequestBlocks;
  }

  return {startSlot, count};
}

export function collectServingHeadRange(
  chain: IBeaconChain,
  startSlot: number,
  endSlot: number,
  archiveMaxSlot: number,
  context?: ServingContext
): Pick<ProtoBlock, "slot" | "blockRoot" | "payloadStatus">[] {
  const head = chain.forkChoice.getHead();
  if (!context) return chain.forkChoice.getAllAncestorBlocks(head.blockRoot, head.payloadStatus).reverse();
  context.assertActive();
  if (!Number.isSafeInteger(endSlot) || endSlot < startSlot || endSlot - startSlot > context.limits.maxIteratorRows)
    throw new ServingCapacityError("range slots");
  const records: Pick<ProtoBlock, "slot" | "blockRoot" | "payloadStatus">[] = [];
  let steps = 0;
  const visit = (block: ProtoBlock): boolean => {
    if (++steps > context.limits.ancestrySteps) throw new ServingCapacityError("ancestry work");
    if (block.slot <= archiveMaxSlot || block.slot < startSlot) return false;
    if (block.slot < endSlot) {
      if (records.length >= endSlot - startSlot) throw new ServingCapacityError("ancestry records");
      records.push({slot: block.slot, blockRoot: block.blockRoot, payloadStatus: block.payloadStatus});
    }
    return true;
  };
  if (visit(head)) {
    for (const block of chain.forkChoice.iterateAncestorBlocks(head.blockRoot, head.payloadStatus)) {
      if (!visit(block)) break;
    }
  }
  return records.reverse();
}
