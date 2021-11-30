import {GENESIS_SLOT, MAX_REQUEST_BLOCKS} from "@chainsafe/lodestar-params";
import {phase0, Slot} from "@chainsafe/lodestar-types";
import {fromHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {RespStatus} from "../../../constants";
import {ResponseError} from "../response";
import {ReqRespBlockResponse} from "../types";

// TODO: Unit test

export async function* onBeaconBlocksByRange(
  requestBody: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ReqRespBlockResponse> {
  const {startSlot, step} = requestBody;
  let {count} = requestBody;
  if (step < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "step < 1");
  }
  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  if (count > MAX_REQUEST_BLOCKS) {
    count = MAX_REQUEST_BLOCKS;
  }

  const lt = startSlot + count * step;
  let archivedBlocksStream: AsyncIterable<ReqRespBlockResponse>;

  if (step > 1) {
    const slots = [];
    for (let slot = startSlot; slot < lt; slot += step) {
      slots.push(slot);
    }
    archivedBlocksStream = getFinalizedBlocksAtSlots(slots, db);
  } else {
    // step < 1 was validated above
    archivedBlocksStream = getFinalizedBlocksByRange(startSlot, lt, db);
  }

  yield* injectRecentBlocks(archivedBlocksStream, chain, db, requestBody);
}

export async function* injectRecentBlocks(
  archiveStream: AsyncIterable<ReqRespBlockResponse>,
  chain: IBeaconChain,
  db: IBeaconDb,
  request: phase0.BeaconBlocksByRangeRequest
): AsyncGenerator<ReqRespBlockResponse> {
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

  const p2pBlocks = await getUnfinalizedBlocksAtSlots(slots, {chain, db});
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

async function* getFinalizedBlocksAtSlots(slots: Slot[], db: IBeaconDb): AsyncIterable<ReqRespBlockResponse> {
  for (const slot of slots) {
    const bytes = await db.blockArchive.getBinary(slot);
    if (bytes !== null) yield {slot, bytes};
  }
}

async function* getFinalizedBlocksByRange(gte: number, lt: number, db: IBeaconDb): AsyncIterable<ReqRespBlockResponse> {
  const binaryEntriesStream = db.blockArchive.binaryEntriesStream({
    gte,
    lt,
  });
  for await (const {key, value} of binaryEntriesStream) {
    const slot = db.blockArchive.decodeKey(key);
    yield {bytes: value, slot};
  }
}

/** Returned blocks have the same ordering as `slots` */
async function getUnfinalizedBlocksAtSlots(
  slots: Slot[],
  {chain, db}: {chain: IBeaconChain; db: IBeaconDb}
): Promise<ReqRespBlockResponse[]> {
  if (slots.length === 0) {
    return [];
  }

  const slotsSet = new Set(slots);
  const minSlot = Math.min(...slots); // Slots must have length > 0
  const blockRootsPerSlot = new Map<Slot, Promise<Uint8Array | null>>();

  // these blocks are on the same chain to head
  for (const block of chain.forkChoice.iterateAncestorBlocks(chain.forkChoice.getHeadRoot())) {
    if (block.slot < minSlot) {
      break;
    } else if (slotsSet.has(block.slot)) {
      blockRootsPerSlot.set(block.slot, db.block.getBinary(fromHexString(block.blockRoot)));
    }
  }

  const unfinalizedBlocks = await Promise.all(slots.map((slot) => blockRootsPerSlot.get(slot)));
  return unfinalizedBlocks
    .map((block, i) => ({bytes: block, slot: slots[i]}))
    .filter((p2pBlock): p2pBlock is ReqRespBlockResponse => p2pBlock.bytes != null);
}
