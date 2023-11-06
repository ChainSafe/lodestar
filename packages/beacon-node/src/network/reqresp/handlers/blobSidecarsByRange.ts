import {GENESIS_SLOT, MAX_REQUEST_BLOCKS_DENEB, BLOBSIDECAR_FIXED_SIZE} from "@lodestar/params";
import {ResponseError, ResponseOutgoing, RespStatus} from "@lodestar/reqresp";
import {deneb, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../../../db/repositories/blobSidecars.js";

export async function* onBlobSidecarsByRange(
  request: deneb.BlobSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // Non-finalized range of blobs
  const {startSlot, count} = validateBlobSidecarsByRangeRequest(request);
  const endSlot = startSlot + count;

  const finalized = db.blobSidecarsArchive;
  const unfinalized = db.blobSidecars;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized range of blobs
  if (startSlot <= finalizedSlot) {
    // Chain of blobs won't change
    for await (const {key, value: blobSideCarsBytesWrapped} of finalized.binaryEntriesStream({
      gte: startSlot,
      lt: endSlot,
    })) {
      yield* iterateBlobBytesFromWrapper(chain, blobSideCarsBytesWrapped, finalized.decodeKey(key));
    }
  }

  // Non-finalized range of blobs
  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    // TODO DENEB: forkChoice should mantain an array of canonical blocks, and change only on reorg
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      // Must include only blobs in the range requested
      if (block.slot >= startSlot && block.slot < endSlot) {
        // Note: Here the forkChoice head may change due to a re-org, so the headChain reflects the canonical chain
        // at the time of the start of the request. Spec is clear the chain of blobs must be consistent, but on
        // re-org there's no need to abort the request
        // Spec: https://github.com/ethereum/consensus-specs/blob/a1e46d1ae47dd9d097725801575b46907c12a1f8/specs/eip4844/p2p-interface.md#blobssidecarsbyrange-v1

        const blobSideCarsBytesWrapped = await unfinalized.getBinary(fromHex(block.blockRoot));
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
  const blobsLen = allBlobSideCarsBytes.length / BLOBSIDECAR_FIXED_SIZE;

  for (let index = 0; index < blobsLen; index++) {
    const blobSideCarBytes = allBlobSideCarsBytes.slice(
      index * BLOBSIDECAR_FIXED_SIZE,
      (index + 1) * BLOBSIDECAR_FIXED_SIZE
    );
    if (blobSideCarBytes.length !== BLOBSIDECAR_FIXED_SIZE) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `Invalid blobSidecar index=${index} bytes length=${blobSideCarBytes.length} expected=${BLOBSIDECAR_FIXED_SIZE} for slot ${blockSlot} blobsLen=${blobsLen}`
      );
    }
    yield {
      data: blobSideCarBytes,
      fork: chain.config.getForkName(blockSlot),
    };
  }
}

export function validateBlobSidecarsByRangeRequest(
  request: deneb.BlobSidecarsByRangeRequest
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

  if (count > MAX_REQUEST_BLOCKS_DENEB) {
    count = MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count};
}
