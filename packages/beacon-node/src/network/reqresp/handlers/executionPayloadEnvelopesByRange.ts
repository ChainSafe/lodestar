import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {prettyPrintPeerId} from "../../util.js";

export async function* onExecutionPayloadEnvelopesByRange(
  request: gloas.ExecutionPayloadEnvelopesByRangeRequest,
  chain: IBeaconChain,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateExecutionPayloadEnvelopesByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  // endSlot is exclusive, so highest served slot is endSlot - 1.
  // Throw only when the entire requested range is below earliestAvailableSlot.
  if (endSlot - 1 < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer requested range before earliestAvailableSlot for ExecutionPayloadEnvelopesByRange", {
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
  // The finalized block's envelope stays in hot db until the next finalization run, so the archive
  // tops out at finalizedSlot - 1.
  const {finalizedSlot, nonFinalized} = chain.getFullBlockRootSlotsByRange(startSlot, endSlot);
  const archiveMaxSlot = finalizedSlot - 1;

  // Finalized range: point-read the cold archive per slot; skipped slots have no envelope.
  if (startSlot <= archiveMaxSlot) {
    const lt = Math.min(endSlot, archiveMaxSlot + 1);
    for (let slot = startSlot; slot < lt; slot++) {
      const envelopeBytes = await chain.getSerializedFinalizedExecutionPayloadEnvelope(slot);
      if (!envelopeBytes) continue;
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }

  // Non-finalized range: point-read each canonical FULL block's envelope by (slot, root).
  for (const {slot, root} of nonFinalized) {
    const envelopeBytes = await chain.getSerializedExecutionPayloadEnvelope(slot, root);
    if (!envelopeBytes) {
      throw new ResponseError(
        RespStatus.SERVER_ERROR,
        `No envelope for slot ${slot}, startSlot=${startSlot} endSlot=${endSlot} finalizedSlot=${finalizedSlot}`
      );
    }
    yield {
      data: envelopeBytes,
      boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
    };
  }
}

export function validateExecutionPayloadEnvelopesByRangeRequest(
  config: ChainConfig,
  request: gloas.ExecutionPayloadEnvelopesByRangeRequest
): gloas.ExecutionPayloadEnvelopesByRangeRequest {
  const {startSlot} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // The gloas req/resp spec uses MIN_EPOCHS_FOR_BLOCK_REQUESTS to define the minimum range peers MUST serve.
  // Archival nodes may still serve older retained payloads to allow genesis sync.

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count};
}
