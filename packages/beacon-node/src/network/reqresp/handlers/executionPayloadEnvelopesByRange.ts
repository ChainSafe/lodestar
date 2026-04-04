import {ChainConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

export async function* onExecutionPayloadEnvelopesByRange(
  request: gloas.ExecutionPayloadEnvelopesByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateExecutionPayloadEnvelopesByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  if (startSlot < chain.earliestAvailableSlot) {
    return;
  }

  const finalized = db.executionPayloadEnvelopeArchive;
  const finalizedSlot = chain.forkChoice.getFinalizedCheckpointSlot();

  // Finalized range of envelopes
  if (startSlot <= finalizedSlot) {
    for await (const {key, value: envelopeBytes} of finalized.binaryEntriesStream({
      gte: startSlot,
      lt: endSlot,
    })) {
      const slot = finalized.decodeKey(key);
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }

  // Non-finalized range of envelopes
  if (endSlot > finalizedSlot) {
    const headBlock = chain.forkChoice.getHead();
    const headRoot = headBlock.blockRoot;
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot, headBlock.payloadStatus);

    // Iterate head chain with ascending block numbers
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];

      if (block.slot >= startSlot && block.slot < endSlot) {
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

  // The gloas req/resp spec defines the recent range peers MUST support serving.
  // Archival nodes may still serve older retained payloads to allow genesis sync.

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count};
}
