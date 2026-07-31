import {ChainConfig} from "@lodestar/config";
import {BLOB_SIDECAR_FIXED_SIZE, GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot, deneb} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../../../db/repositories/blobSidecars.js";

export async function* onBlobSidecarsByRange(
  request: deneb.BlobSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // Non-finalized range of blobs
  const {startSlot, count} = validateBlobSidecarsByRangeRequest(chain.config, chain.clock.currentEpoch, request);
  const endSlot = startSlot + count;

  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;
  const archiveMaxSlot = finalizedSlot;
  const headBlock = chain.forkChoice.getHead();
  // The canonical walk reaches back to the previous finalized boundary. Within that range fork choice is
  // authoritative: a missing block means the canonical chain skipped the slot, not that storage should choose a root.
  const headChain = chain.forkChoice.getAllAncestorBlocks(headBlock.blockRoot, headBlock.payloadStatus);
  const canonicalBlocksBySlot = new Map(headChain.map((block) => [block.slot, block]));
  const oldestForkChoiceSlot = headChain.at(-1)?.slot ?? Number.POSITIVE_INFINITY;

  // Finalized range of blobs
  if (startSlot <= archiveMaxSlot) {
    for (let slot = startSlot; slot < Math.min(endSlot, archiveMaxSlot + 1); slot++) {
      let blobSideCarsBytesWrapped: Uint8Array | null;
      if (slot >= oldestForkChoiceSlot) {
        const canonicalBlock = canonicalBlocksBySlot.get(slot);
        if (!canonicalBlock) continue;
        blobSideCarsBytesWrapped = await db.flatFileStore.getBlobSidecarsBinary(slot, canonicalBlock.blockRoot);
      } else {
        blobSideCarsBytesWrapped = await db.flatFileStore.getBlobSidecarsBinaryBySlot(slot);
      }
      if (!blobSideCarsBytesWrapped) {
        continue;
      }
      yield* iterateBlobBytesFromWrapper(chain, blobSideCarsBytesWrapped, slot);
    }
  }

  // Non-finalized range of blobs
  if (endSlot > archiveMaxSlot) {
    // TODO DENEB: forkChoice should mantain an array of canonical blocks, and change only on reorg
    // `getAllAncestorBlocks` includes both the head and the previous-finalized boundary.

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only blobs in the range requested, and skip anything the archive loop
      // above already served via the block.slot > archiveMaxSlot filter.
      if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // at the time of the start of the request. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blobSideCarsBytesWrapped = await db.flatFileStore.getBlobSidecarsBinary(block.slot, block.blockRoot);
        if (!blobSideCarsBytesWrapped) {
          // Handle the same to onBeaconBlocksByRange
          throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
        }
        yield* iterateBlobBytesFromWrapper(chain, blobSideCarsBytesWrapped, block.slot);
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}

export function* iterateBlobBytesFromWrapper(
  chain: IBeaconChain,
  blobSideCarsBytesWrapped: Uint8Array,
  blockSlot: Slot
): Iterable<ResponseOutgoing> {
  const allBlobSideCarsBytes = blobSideCarsBytesWrapped.slice(BLOB_SIDECARS_IN_WRAPPER_INDEX);
  const blobsLen = allBlobSideCarsBytes.length / BLOB_SIDECAR_FIXED_SIZE;

  for (let index = 0; index < blobsLen; index++) {
    const blobSideCarBytes = allBlobSideCarsBytes.slice(
      index * BLOB_SIDECAR_FIXED_SIZE,
      (index + 1) * BLOB_SIDECAR_FIXED_SIZE
    );
    if (blobSideCarBytes.length !== BLOB_SIDECAR_FIXED_SIZE) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `Invalid blobSidecar index=${index} bytes length=${blobSideCarBytes.length} expected=${BLOB_SIDECAR_FIXED_SIZE} for slot ${blockSlot} blobsLen=${blobsLen}`
      );
    }
    yield {
      data: blobSideCarBytes,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(blockSlot)),
    };
  }
}

export function validateBlobSidecarsByRangeRequest(
  config: ChainConfig,
  currentEpoch: Epoch,
  request: deneb.BlobSidecarsByRangeRequest
): deneb.BlobSidecarsByRangeRequest {
  const {startSlot} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // Spec: [max(current_epoch - MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS, DENEB_FORK_EPOCH), current_epoch]
  const minimumRequestEpoch = Math.max(
    currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS,
    config.DENEB_FORK_EPOCH
  );
  if (computeEpochAtSlot(startSlot) < minimumRequestEpoch) {
    throw new ResponseError(
      RespStatus.RESOURCE_UNAVAILABLE,
      "startSlot is before MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS"
    );
  }

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count};
}
