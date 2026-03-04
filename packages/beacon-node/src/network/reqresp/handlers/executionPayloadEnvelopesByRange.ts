import {PeerId} from "@libp2p/interface";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.ts";
import {validateBeaconBlocksByRangeRequest} from "./beaconBlocksByRange.js";

/**
 * Serve signed execution payload envelopes over req/resp by range.
 *
 * Behavior is equivalent to BeaconBlocksByRange v2 but with envelope responses,
 * matching spec for ExecutionPayloadEnvelopesByRange.
 */
export async function* onExecutionPayloadEnvelopesByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateBeaconBlocksByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  if (startSlot < chain.earliestAvailableSlot) {
    chain.logger.verbose("Peer did not respect earliestAvailableSlot for ExecutionPayloadEnvelopesByRange", {
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
    });
    return;
  }

  const finalizedSlot = chain.forkChoice.getFinalizedCheckpointSlot();

  // Finalized range (archived by slot)
  if (startSlot <= finalizedSlot) {
    const finalizedEndSlot = Math.min(endSlot, finalizedSlot + 1);

    for (let slot = startSlot; slot < finalizedEndSlot; slot++) {
      const envelope = await db.executionPayloadEnvelopeArchive.get(slot);
      if (!envelope) {
        continue;
      }

      yield {
        data: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }

  // Non-finalized range (canonical head chain by root)
  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);

    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      if (block.slot >= startSlot && block.slot < endSlot) {
        const envelope = await db.executionPayloadEnvelope.get(fromHex(block.blockRoot));
        if (!envelope) {
          continue;
        }

        yield {
          data: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
        };
      } else if (block.slot >= endSlot) {
        break;
      }
    }
  }
}
