import {ForkSeq} from "@lodestar/params";
import {ResponseError, ResponseOutgoing, RespStatus} from "@lodestar/reqresp";
import {RootHex, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import type {PeerId} from "@libp2p/interface";
import {IBeaconChain} from "../../../chain/interface.js";
import {MAX_REQUEST_PAYLOAD_ENVELOPES_BY_ROOT} from "../../../constants/index.js";
import {IBeaconDb} from "../../../db/index.js";

/**
 * Handler for ExecutionPayloadEnvelopesByRoot ReqResp protocol.
 *
 * Fetches execution payload envelopes by beacon block root.
 * Used for unknown payload sync when a peer attestation references a payload we don't have.
 *
 * Request: List of beacon block roots
 * Response: Stream of SignedExecutionPayloadEnvelope (one per root, if available)
 */
export async function* onExecutionPayloadEnvelopesByRoot(
  requestBody: Uint8Array,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  // Deserialize request
  const request = ssz.phase0.BeaconBlocksByRootRequest.deserialize(requestBody);

  // Validate request size
  if (request.length > MAX_REQUEST_PAYLOAD_ENVELOPES_BY_ROOT) {
    throw new ResponseError(
      RespStatus.INVALID_REQUEST,
      `Requested ${request.length} payload envelopes, max is ${MAX_REQUEST_PAYLOAD_ENVELOPES_BY_ROOT}`
    );
  }

  // Fetch payload envelopes from database
  for (const blockRoot of request) {
    const blockRootHex = toRootHex(blockRoot);

    // Check if block exists in fork choice
    if (!chain.forkChoice.hasBlock(blockRootHex)) {
      // Block not in fork choice, skip
      continue;
    }

    // Get block to check slot and fork
    // NOTE: On unstable: use getBlockHex(blockRoot)
    // On nc/epbs-fc: use getBlockHexDefaultStatus(blockRoot) - getBlockHex now requires payloadStatus param
    const block = chain.forkChoice.getBlockHex(blockRootHex);
    if (!block) continue;

    // Check if Gloas fork (only Gloas blocks have separate payload envelopes)
    const forkSeq = chain.config.getForkSeq(block.slot);
    if (forkSeq < ForkSeq.gloas) {
      // Pre-Gloas blocks don't have separate payloads, skip
      continue;
    }

    // Try to fetch from hot storage first
    let envelope = await db.executionPayloadEnvelope.get(blockRoot);

    // If not in hot storage, try archive
    if (!envelope) {
      envelope = await db.executionPayloadEnvelopeArchive.get(block.slot);
    }

    // If found, yield the payload envelope
    if (envelope) {
      yield {
        data: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
        // No fork boundary needed - payload envelopes are Gloas-only
      };
    }

    // If not found, simply skip (peer requested unknown payload)
  }
}
