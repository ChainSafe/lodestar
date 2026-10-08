import {ChainConfig} from "@lodestar/config";
import {BLOB_SIDECAR_FIXED_SIZE, GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot, deneb} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {ServingContext, servingRead} from "../../../chain/serving/context.js";
import {IBeaconDb} from "../../../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../../../db/repositories/blobSidecars.js";
import {collectServingHeadRange} from "./beaconBlocksByRange.js";

export async function* onBlobSidecarsByRange(
  request: deneb.BlobSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  context?: ServingContext
): AsyncIterable<ResponseOutgoing> {
  // Non-finalized range of blobs
  const {startSlot, count} = validateBlobSidecarsByRangeRequest(chain.config, chain.clock.currentEpoch, request);
  const endSlot = startSlot + count;

  const finalized = db.blobSidecarsArchive;
  const unfinalized = db.blobSidecars;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;
  // Blobs are migrated to blobSidecarsArchive at finalization (including the finalized block
  // itself), so the archive loop serves up to AND INCLUDING finalizedSlot and the headChain
  // loop starts above it to avoid duplicate yields. See archiveBlocks.ts for the migration logic.
  const archiveMaxSlot = finalizedSlot;

  // Finalized range of blobs
  if (startSlot <= archiveMaxSlot) {
    // Chain of blobs won't change
    for await (const {key, value: blobSideCarsBytesWrapped} of finalized.binaryEntriesStream({
      ...(context ? {...context.streamOptions(), limit: count} : {}),
      gte: startSlot,
      lt: Math.min(endSlot, archiveMaxSlot + 1),
    })) {
      yield* iterateBlobBytesFromWrapper(chain, blobSideCarsBytesWrapped, finalized.decodeKey(key), context);
    }
  }

  // Non-finalized range of blobs
  if (endSlot > archiveMaxSlot) {
    const headChain = collectServingHeadRange(chain, startSlot, endSlot, archiveMaxSlot, context);
    for (const block of headChain) {
      // Must include only blobs in the range requested, and skip anything the archive loop
      // above already served via the block.slot > archiveMaxSlot filter.
      if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // after the archive reads. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blobSideCarsBytesWrapped = await servingRead(context, (opts) =>
          unfinalized.getBinary(fromHex(block.blockRoot), opts)
        );
        if (!blobSideCarsBytesWrapped) {
          // Handle the same to onBeaconBlocksByRange
          throw new ResponseError(RespStatus.SERVER_ERROR, `No item for root ${block.blockRoot} slot ${block.slot}`);
        }
        yield* iterateBlobBytesFromWrapper(chain, blobSideCarsBytesWrapped, block.slot, context);
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
  blockSlot: Slot,
  context?: ServingContext
): Iterable<ResponseOutgoing> {
  context?.checkBacking(blobSideCarsBytesWrapped);
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
  if (!Number.isSafeInteger(startSlot)) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot is not a safe integer");
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

  if (!Number.isSafeInteger(startSlot + count)) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "range end is not a safe integer");
  }

  return {startSlot, count};
}
