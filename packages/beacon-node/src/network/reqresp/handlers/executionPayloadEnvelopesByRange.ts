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
  const step = request.step > 0 ? request.step : 1;
  const endSlot = startSlot + count * step;

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

    for (let slot = startSlot; slot < finalizedEndSlot; slot += step) {
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
  const nonFinalizedStartSlot = Math.max(startSlot, finalizedSlot + 1);
  if (endSlot > nonFinalizedStartSlot) {
    const seenRoots = new Set<string>();

    const maybeYieldEnvelope = async function* (block: {slot: number; blockRoot: string}) {
      if (block.slot < nonFinalizedStartSlot || block.slot >= endSlot || (block.slot - startSlot) % step !== 0) {
        return;
      }
      if (seenRoots.has(block.blockRoot)) {
        return;
      }
      const envelope = await db.executionPayloadEnvelope.get(fromHex(block.blockRoot));
      if (!envelope) {
        return;
      }

      seenRoots.add(block.blockRoot);
      yield {
        data: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope),
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
      };
    };

    const headRoot = chain.forkChoice.getHeadRoot();
    const headBlock = chain.forkChoice.getBlockHexDefaultStatus(headRoot);
    if (headBlock) {
      yield* maybeYieldEnvelope(headBlock);
    }

    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      if (block.slot < nonFinalizedStartSlot) {
        continue;
      }
      if (block.slot >= endSlot) {
        break;
      }

      yield* maybeYieldEnvelope(block);
    }
  }
}
