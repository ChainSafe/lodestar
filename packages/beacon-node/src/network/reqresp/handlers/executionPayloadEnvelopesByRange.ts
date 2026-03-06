import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.ts";

/**
 * Serve signed execution payload envelopes over req/resp by range.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/master/specs/gloas/p2p-interface.md#executionpayloadenvelopesbyrange-v1
 */
export async function* onExecutionPayloadEnvelopesByRange(
  request: gloas.ExecutionPayloadEnvelopesByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateEnvelopesByRangeRequest(chain.config, request);
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
  // Note: getAllAncestorBlocks excludes the Gloas head (PENDING variant),
  // so we must check the head separately via getBlockHexDefaultStatus.
  const nonFinalizedStartSlot = Math.max(startSlot, finalizedSlot + 1);
  if (endSlot > nonFinalizedStartSlot) {
    const seenRoots = new Set<string>();

    const yieldEnvelope = async function* (block: {slot: number; blockRoot: string}) {
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

    // Iterate ancestors oldest-to-newest (ascending slot order)
    const head = chain.forkChoice.getHead();
    const headChain = chain.forkChoice.getAllAncestorBlocks(head);
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      if (block.slot < nonFinalizedStartSlot) {
        continue;
      }
      if (block.slot >= endSlot) {
        break;
      }

      yield* yieldEnvelope(block);
    }

    // Head block (may be excluded from ancestor list for Gloas PENDING variant)
    const headBlock = chain.forkChoice.getBlockHexDefaultStatus(head.blockRoot);
    if (headBlock && headBlock.slot >= nonFinalizedStartSlot && headBlock.slot < endSlot) {
      yield* yieldEnvelope(headBlock);
    }
  }
}

export function validateEnvelopesByRangeRequest(
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
  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count};
}
