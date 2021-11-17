import {GENESIS_SLOT, MAX_REQUEST_BLOCKS} from "@chainsafe/lodestar-params";
import {P2pBlockResponse, phase0} from "@chainsafe/lodestar-types";
import {IBlockFilterOptions} from "../../../db/repositories";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {RespStatus} from "../../../constants";
import {ResponseError} from "../response";

// TODO: Unit test

export async function* onBeaconBlocksByRange(
  requestBody: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<P2pBlockResponse> {
  if (requestBody.step < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "step < 1");
  }
  if (requestBody.count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (requestBody.startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  if (requestBody.count > MAX_REQUEST_BLOCKS) {
    requestBody.count = MAX_REQUEST_BLOCKS;
  }

  const archiveBlocksStream = db.blockArchive.p2pBlockStream({
    gte: requestBody.startSlot,
    lt: requestBody.startSlot + requestBody.count * requestBody.step,
    step: requestBody.step,
  } as IBlockFilterOptions);
  yield* injectRecentBlocks(archiveBlocksStream, chain, requestBody);
}

export async function* injectRecentBlocks(
  archiveStream: AsyncIterable<P2pBlockResponse>,
  chain: IBeaconChain,
  request: phase0.BeaconBlocksByRangeRequest
): AsyncGenerator<P2pBlockResponse> {
  let totalBlock = 0;
  let slot = -1;
  for await (const p2pBlock of archiveStream) {
    totalBlock++;
    yield p2pBlock;
    slot = p2pBlock.slot;
  }
  slot = slot === -1 ? request.startSlot : slot + request.step;
  const upperSlot = request.startSlot + request.count * request.step;
  const slots = [] as number[];
  while (slot < upperSlot) {
    slots.push(slot);
    slot += request.step;
  }

  const p2pBlocks = await chain.getUnfinalizedBlocksAtSlots(slots);
  for (const p2pBlock of p2pBlocks) {
    if (p2pBlock !== undefined) {
      totalBlock++;
      yield p2pBlock;
    }
  }
  if (totalBlock === 0) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No block found");
  }
}
