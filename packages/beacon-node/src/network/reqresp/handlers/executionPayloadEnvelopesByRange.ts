import {ChainConfig} from "@lodestar/config";
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
  const {startSlot, count} = validateEnvelopesByRangeRequest(chain.config, request);
  const endSlot = startSlot + count;
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  // Finalized range: from archive (indexed by slot)
  if (startSlot <= finalizedSlot) {
    for (let slot = startSlot; slot < endSlot && slot <= finalizedSlot; slot++) {
      const envelopeBytes = await db.executionPayloadEnvelopeArchive.getBinary(slot);
      if (envelopeBytes) {
        yield {data: envelopeBytes, boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot))};
      }
    }
  }

  // Non-finalized range: from chain cache
  if (endSlot > finalizedSlot) {
    const headRoot = chain.forkChoice.getHeadRoot();
    const headChain = chain.forkChoice.getAllAncestorBlocks(headRoot);
    for (let i = headChain.length - 1; i >= 0; i--) {
      const block = headChain[i];
      if (block.slot >= startSlot && block.slot < endSlot) {
        const envelopeBytes = await chain.getSerializedExecutionPayloadEnvelope(block.slot, block.blockRoot);
        if (envelopeBytes) {
          yield {data: envelopeBytes, boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot))};
        }
      } else if (block.slot >= endSlot) {
        break;
      }
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
