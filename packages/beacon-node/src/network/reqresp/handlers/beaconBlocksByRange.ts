import {fromHexString} from "@chainsafe/ssz";
import {GENESIS_SLOT, MAX_REQUEST_BLOCKS} from "@lodestar/params";
import {ContextBytesType, EncodedPayload, EncodedPayloadType, ResponseError, RespStatus} from "@lodestar/reqresp";
import {allForks, phase0, Slot} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";

// TODO: Unit test

export async function* onBeaconBlocksByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>> {
  const {startSlot, count} = validateBeaconBlocksByRangeRequest(request);
  const lt = startSlot + count;

  // step < 1 was validated above
  const archivedBlocksStream = getFinalizedBlocksByRange(startSlot, lt, db);

  // Inject recent blocks, not in the finalized cold DB

  let totalBlock = 0;
  let slot = -1;
  for await (const block of archivedBlocksStream) {
    totalBlock++;
    slot = block.slot;
    yield {
      type: EncodedPayloadType.bytes,
      bytes: block.bytes,
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        forkSlot: block.slot,
      },
    };
  }

  slot = slot === -1 ? request.startSlot : slot + request.step;
  const upperSlot = request.startSlot + request.count * request.step;
  const slots = [] as number[];
  while (slot < upperSlot) {
    slots.push(slot);
    slot += request.step;
  }

  const unfinalizedBlocks = await getUnfinalizedBlocksAtSlots(slots, {chain, db});
  for (const block of unfinalizedBlocks) {
    if (block !== undefined) {
      totalBlock++;
      yield {
        type: EncodedPayloadType.bytes,
        bytes: block.bytes,
        contextBytes: {
          type: ContextBytesType.ForkDigest,
          forkSlot: block.slot,
        },
      };
    }
  }
  if (totalBlock === 0) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "No block found");
  }
}

async function* getFinalizedBlocksByRange(
  gte: number,
  lt: number,
  db: IBeaconDb
): AsyncIterable<{slot: Slot; bytes: Uint8Array}> {
  const binaryEntriesStream = db.blockArchive.binaryEntriesStream({
    gte,
    lt,
  });
  for await (const {key, value} of binaryEntriesStream) {
    yield {
      slot: db.blockArchive.decodeKey(key),
      bytes: value,
    };
  }
}

/** Returned blocks have the same ordering as `slots` */
async function getUnfinalizedBlocksAtSlots(
  slots: Slot[],
  {chain, db}: {chain: IBeaconChain; db: IBeaconDb}
): Promise<{slot: Slot; bytes: Uint8Array}[]> {
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

  const unfinalizedBlocksOrNull = await Promise.all(slots.map((slot) => blockRootsPerSlot.get(slot)));

  const unfinalizedBlocks: {slot: Slot; bytes: Uint8Array}[] = [];

  for (let i = 0; i < unfinalizedBlocksOrNull.length; i++) {
    const block = unfinalizedBlocksOrNull[i];
    if (block) {
      unfinalizedBlocks.push({
        slot: slots[i],
        bytes: block,
      });
    }
  }

  return unfinalizedBlocks;
}

function validateBeaconBlocksByRangeRequest(
  request: phase0.BeaconBlocksByRangeRequest
): phase0.BeaconBlocksByRangeRequest {
  const {startSlot, step} = request;
  let {count} = request;
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

  if (step > 1) {
    // step > 1 is deprecated, see https://github.com/ethereum/consensus-specs/pull/2856
    count = 1;
  }

  if (count > MAX_REQUEST_BLOCKS) {
    count = MAX_REQUEST_BLOCKS;
  }

  return {
    startSlot,
    step,
    count,
  };
}
