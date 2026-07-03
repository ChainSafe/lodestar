import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT, isForkPostDeneb} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {deneb, phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {prettyPrintPeerId} from "../../util.js";

export async function* onBeaconBlocksByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateBeaconBlocksByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

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

  // Fork choice is read inside the engine; only thin refs cross (slot + raw root), no ProtoBlock.
  // Blocks incl. the finalized block are migrated to the archive at finalization, so the archive loop
  // serves up to AND INCLUDING finalizedSlot and the non-finalized refs start above it.
  const {finalizedSlot, nonFinalized} = chain.getCanonicalBlockRootSlotsByRange(startSlot, endSlot);
  const archiveMaxSlot = finalizedSlot;

  // Finalized range: point-read the cold archive per slot; skipped slots return null.
  if (startSlot <= archiveMaxSlot) {
    const lt = Math.min(endSlot, archiveMaxSlot + 1);
    for (let slot = startSlot; slot < lt; slot++) {
      const blockBytes = await chain.getSerializedFinalizedBlockBySlot(slot);
      if (!blockBytes) continue;
      yield {
        data: blockBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }

  // Non-finalized range: point-read each canonical block by root (hot→cold via the engine).
  // Note: the fork-choice head may change due to a re-org, so `nonFinalized` reflects the canonical chain
  // at the time the refs were taken. Spec requires the chain of blocks be consistent, but on re-org there's
  // no need to abort the request.
  for (const {slot, root} of nonFinalized) {
    const res = await chain.getSerializedBlockByRoot(root);
    if (!res) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `No block for slot ${slot}, startSlot=${startSlot} endSlot=${endSlot} finalizedSlot=${finalizedSlot}`
      );
    }
    yield {
      data: res.block,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
    };
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
