import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {deneb} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

export async function* onBlobSidecarsByRange(
  request: deneb.BlobSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // Non-finalized range of blobs
  const {startSlot, count} = validateBlobSidecarsByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  const finalized = db.blobSidecarArchive;
  const unfinalized = db.blobSidecar;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized range of blobs
  if (startSlot <= finalizedSlot) {
    for (let slot = startSlot; slot < endSlot; slot++) {
      for await (const {value: blobSideCarBytes} of finalized.valuesStreamBinary(slot)) {
        if (!blobSideCarBytes) {
          throw new ResponseError(RespStatus.SERVER_ERROR, `No finalized blobSidecar found for slot=${slot}`);
        }

        yield {
          data: blobSideCarBytes,
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
        };
      }
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

        for await (const {value: blobSideCarBytes} of unfinalized.valuesStreamBinary({
          blockRoot: fromHex(block.blockRoot),
          slot: block.slot,
        })) {
          if (!blobSideCarBytes) {
            throw new ResponseError(
              RespStatus.SERVER_ERROR,
              `No unfinalized blobSidecar found for blockRoot=${block.blockRoot}`
            );
          }

          yield {
            data: blobSideCarBytes,
            boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
          };
        }
      }

      // If block is after endSlot, stop iterating
      else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}

export function validateBlobSidecarsByRangeRequest(
  config: BeaconConfig,
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

  const maxRequestBlobSidecars = config.getMaxRequestBlobSidecars(config.getForkName(startSlot));

  if (count > maxRequestBlobSidecars) {
    count = maxRequestBlobSidecars;
  }

  return {startSlot, count};
}
