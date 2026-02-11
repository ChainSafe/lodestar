import {ForkSeq} from "@lodestar/params";
import {ResponseError, ResponseOutgoing, RespStatus} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import type {PeerId} from "@libp2p/interface";
import {IBeaconChain} from "../../../chain/interface.js";
import {MAX_REQUEST_PAYLOAD_ENVELOPES_BY_RANGE} from "../../../constants/index.js";
import {IBeaconDb} from "../../../db/index.js";

/**
 * Handler for ExecutionPayloadEnvelopesByRange ReqResp protocol.
 *
 * Request: {startSlot, count}
 * Response: Stream of SignedExecutionPayloadEnvelope
 *
 * Supports both finalized and non-finalized slots.
 * Handles payload unavailability gracefully (builder didn't reveal payload).
 */
export async function* onExecutionPayloadEnvelopesByRange(
  requestBody: Uint8Array,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  // TODO: Define ExecutionPayloadEnvelopesByRangeRequest SSZ type
  // For now, assume: {startSlot: Slot, count: number}

  // TODO: Deserialize request
  // const request = ssz.gloas.ExecutionPayloadEnvelopesByRangeRequest.deserialize(requestBody);

  // TODO: Validate request
  // - Check count <= MAX_REQUEST_PAYLOAD_ENVELOPES_BY_RANGE
  // - Check startSlot >= GENESIS_SLOT
  // - Check startSlot >= chain.earliestAvailableSlot

  // TODO: Get finalized slot
  // const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // TODO: Handle finalized range (startSlot to min(endSlot, finalizedSlot))
  // for (let slot = startSlot; slot <= Math.min(endSlot, finalizedSlot); slot++) {
  //   // Check if slot has Gloas block
  //   const forkSeq = chain.config.getForkSeq(slot);
  //   if (forkSeq < ForkSeq.gloas) continue;
  //
  //   // Fetch from archive
  //   const envelope = await db.executionPayloadEnvelopeArchive.get(slot);
  //   if (envelope) {
  //     yield {
  //       data: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
  //       boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
  //     };
  //   }
  //   // If not found: payload unavailable (builder didn't reveal), skip silently
  // }

  // TODO: Handle non-finalized range (finalizedSlot+1 to endSlot)
  // const headRoot = chain.forkChoice.getHeadRoot();
  // const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);
  //
  // // Iterate in ascending slot order
  // for (let i = headChain.length - 1; i >= 0; i--) {
  //   const block = headChain[i];
  //   if (block.slot < Math.max(startSlot, finalizedSlot + 1)) continue;
  //   if (block.slot >= endSlot) break;
  //
  //   // Check if Gloas block
  //   const forkSeq = chain.config.getForkSeq(block.slot);
  //   if (forkSeq < ForkSeq.gloas) continue;
  //
  //   // Fetch from hot DB (keyed by blockRoot)
  //   const envelope = await db.executionPayloadEnvelope.get(block.blockRoot);
  //   if (envelope) {
  //     yield {
  //       data: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
  //       boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
  //     };
  //   }
  //   // If not found: payload unavailable, skip silently
  // }

  throw new Error("ExecutionPayloadEnvelopesByRange not yet fully implemented - see TODOs above");
}
