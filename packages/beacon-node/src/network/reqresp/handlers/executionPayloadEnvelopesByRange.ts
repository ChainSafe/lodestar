import {ChainConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

export async function* onExecutionPayloadEnvelopesByRange(
  request: gloas.ExecutionPayloadEnvelopesByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  const {startSlot, count} = validateExecutionPayloadEnvelopesByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;

  const finalized = db.executionPayloadEnvelopeArchive;
  const unfinalized = db.executionPayloadEnvelope;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

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
        // TODO GLOAS: Use chain.getSerializedExecutionPayloadEnvelope() to check in-memory caches when the method is available
        const envelopeBytes = await unfinalized.getBinary(fromHex(block.blockRoot));
        if (envelopeBytes) {
          yield {
            data: envelopeBytes,
            boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
          };
        }
        // In ePBS, missing envelopes are valid (payload withholding) — skip silently
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

  if (count > config.MAX_REQUEST_BLOCKS_DENEB) {
    count = config.MAX_REQUEST_BLOCKS_DENEB;
  }

  return {startSlot, count};
}
