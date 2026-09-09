import {PeerId} from "@libp2p/interface";
import {ChainConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {prettyPrintPeerId} from "../../util.js";

export async function* onExecutionPayloadEnvelopesByRange(
  request: gloas.ExecutionPayloadEnvelopesByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
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

  const finalized = db.executionPayloadEnvelopeArchive;
  // Use the finalized block's actual slot as the checkpoint epoch-boundary slot may be skipped
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;
  // The finalized block's envelope stays in the hot db until the next finalization run
  const archiveMaxSlot = finalizedSlot - 1;

  // Finalized range of envelopes
  if (startSlot <= archiveMaxSlot) {
    for await (const {key, value: envelopeBytes} of finalized.binaryEntriesStream({
      gte: startSlot,
      lt: Math.min(endSlot, archiveMaxSlot + 1),
    })) {
      const slot = finalized.decodeKey(key);
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }

  // Non-finalized range of envelopes
  if (endSlot > archiveMaxSlot) {
    const headBlock = chain.forkChoice.getHead();
    const headRoot = headBlock.blockRoot;
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot, headBlock.payloadStatus);

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
        // Skip EMPTY blocks
        if (block.payloadStatus !== PayloadStatus.FULL) {
          continue;
        }

        const envelopeBytes = await chain.getSerializedExecutionPayloadEnvelope(block.slot, block.blockRoot);
        if (!envelopeBytes) {
          throw new ResponseError(
            RespStatus.SERVER_ERROR,
            `No envelope for root ${block.blockRoot} slot ${block.slot}, startSlot=${startSlot} endSlot=${endSlot} finalizedSlot=${finalizedSlot}`
          );
        }

        yield {
          data: envelopeBytes,
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
        };
      } else if (block.slot >= endSlot) {
        break;
      }
    }
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

  // Spec: EnvelopesByRange response is bounded by MAX_REQUEST_PAYLOADS (consensus-specs #5383),
  // distinct from the MAX_REQUEST_BLOCKS_DENEB cap used for block-by-range.
  if (count > config.MAX_REQUEST_PAYLOADS) {
    count = config.MAX_REQUEST_PAYLOADS;
  }

  return {startSlot, count};
}
