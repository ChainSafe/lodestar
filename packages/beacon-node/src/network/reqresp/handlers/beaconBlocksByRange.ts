import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {deneb, phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.ts";

// TODO: Unit test

export async function* onBeaconBlocksByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateBeaconBlocksByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  const finalized = db.blockArchive;
  // in the case of initializing from a non-finalized state, we don't have the finalized block so this api does not work
  const finalizedBlock = chain.forkChoice.getFinalizedBlock();
  const finalizedSlot = finalizedBlock.slot;

  const forkName = chain.config.getForkName(startSlot);
  if (isForkPostFulu(forkName) && startSlot < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer did not respect earliestAvailableSlot for BeaconBlocksByRange", {
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
    });
    return;
  }

  // Finalized range of blocks
  if (startSlot <= finalizedSlot) {
    const finalizedEntries: Array<{slot: number; data: Uint8Array}> = [];
    for await (const {key, value} of finalized.binaryEntriesStream({gte: startSlot, lt: endSlot})) {
      finalizedEntries.push({slot: finalized.decodeKey(key), data: value});
    }

    // The finalized boundary block may still be in hot storage during archive transitions.
    // Ensure the canonical finalized block is included when it falls inside the requested range,
    // otherwise the response may incorrectly start at the next block (e.g. 97..127 instead of 96..127).
    if (finalizedBlock.slot >= startSlot && finalizedBlock.slot < endSlot) {
      const hasFinalizedBoundary = finalizedEntries.some((entry) => entry.slot === finalizedBlock.slot);
      if (!hasFinalizedBoundary) {
        const finalizedBoundaryBlock = await chain.getSerializedBlockByRoot(finalizedBlock.blockRoot);
        if (finalizedBoundaryBlock) {
          finalizedEntries.push({slot: finalizedBoundaryBlock.slot, data: finalizedBoundaryBlock.block});
        }
      }
    }

    finalizedEntries.sort((a, b) => a.slot - b.slot);
    for (const {slot, data} of finalizedEntries) {
      yield {
        data,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }

  // Non-finalized range of blocks
  if (endSlot > finalizedSlot) {
    const head = chain.forkChoice.getHead();
    // TODO DENEB: forkChoice should mantain an array of canonical blocks, and change only on reorg
    const headChain = chain.forkChoice.getAllAncestorBlocks(head);
    // getAllAncestorBlocks response includes the head node, so it's the full chain.

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only blocks in the range requested
      if (block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // at the time of the start of the request. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blockBytes = await chain.getSerializedBlockByRoot(block.blockRoot);
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
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // step > 1 is deprecated, see https://github.com/ethereum/consensus-specs/pull/2856

  const maxRequestBlocks = isForkPostDeneb(config.getForkName(startSlot))
    ? config.MAX_REQUEST_BLOCKS_DENEB
    : config.MAX_REQUEST_BLOCKS;

  if (count > maxRequestBlocks) {
    count = maxRequestBlocks;
  }

  return {startSlot, count};
}
