import {GENESIS_SLOT} from "@chainsafe/lodestar-beacon-state-transition";
import {MAX_REQUEST_BLOCKS} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {IBlockFilterOptions} from "../../../db/repositories";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {RpcResponseStatus} from "../../../constants";
import {ResponseError} from "../response";

// TODO: Unit test

export async function* onBeaconBlocksByRange(
  requestBody: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<phase0.SignedBeaconBlock> {
  if (requestBody.step < 1) {
    throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "step < 1");
  }
  if (requestBody.count < 1) {
    throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "count < 1");
  }
  if (requestBody.startSlot < GENESIS_SLOT) {
    throw new ResponseError(RpcResponseStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  if (requestBody.count > MAX_REQUEST_BLOCKS) {
    requestBody.count = MAX_REQUEST_BLOCKS;
  }

  const archiveBlocksStream = db.blockArchive.valuesStream({
    gte: requestBody.startSlot,
    lt: requestBody.startSlot + requestBody.count * requestBody.step,
    step: requestBody.step,
  } as IBlockFilterOptions);
  yield* injectRecentBlocks(archiveBlocksStream, chain, requestBody);
}

export async function* injectRecentBlocks(
  archiveStream: AsyncIterable<phase0.SignedBeaconBlock>,
  chain: IBeaconChain,
  request: phase0.BeaconBlocksByRangeRequest
): AsyncGenerator<phase0.SignedBeaconBlock> {
  let slot = -1;
  for await (const archiveBlock of archiveStream) {
    yield archiveBlock;
    slot = archiveBlock.message.slot;
  }
  slot = slot === -1 ? request.startSlot : slot + request.step;
  const upperSlot = request.startSlot + request.count * request.step;
  const slots = [] as number[];
  while (slot < upperSlot) {
    slots.push(slot);
    slot += request.step;
  }

  const blocks = (await chain.getUnfinalizedBlocksAtSlots(slots)) || [];
  for (const block of blocks) {
    if (block) {
      yield block;
    }
  }
}
