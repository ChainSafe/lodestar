import {allForks, phase0} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

/**
 * Asserts a response from BeaconBlocksByRange respects the request and is sequential
 * Note: MUST allow missing block for skipped slots.
 */
export function assertSequentialBlocksInRange(
  blocks: allForks.SignedBeaconBlock[],
  {count, startSlot, step}: phase0.BeaconBlocksByRangeRequest
): void {
  // Check below would throw for empty ranges
  if (blocks.length === 0) {
    return;
  }

  const length = blocks.length;
  if (length > count) {
    throw new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_LENGTH, count, length});
  }

  const maxSlot = startSlot + count * (step || 1) - 1;
  const firstSlot = blocks[0].message.slot;
  const lastSlot = blocks[blocks.length - 1].message.slot;

  if (firstSlot < startSlot) {
    throw new BlocksByRangeError({code: BlocksByRangeErrorCode.UNDER_START_SLOT, startSlot, firstSlot});
  }

  if (lastSlot > maxSlot) {
    throw new BlocksByRangeError({code: BlocksByRangeErrorCode.OVER_MAX_SLOT, maxSlot, lastSlot});
  }

  // Assert sequential with request.step
  for (let i = 0; i < blocks.length - 1; i++) {
    const slotL = blocks[i].message.slot;
    const slotR = blocks[i + 1].message.slot;
    if (slotL + step > slotR) {
      throw new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE, step, slotL, slotR});
    }
  }
}

export enum BlocksByRangeErrorCode {
  BAD_LENGTH = "BLOCKS_BY_RANGE_ERROR_BAD_LENGTH",
  UNDER_START_SLOT = "BLOCKS_BY_RANGE_ERROR_UNDER_START_SLOT",
  OVER_MAX_SLOT = "BLOCKS_BY_RANGE_ERROR_OVER_MAX_SLOT",
  BAD_SEQUENCE = "BLOCKS_BY_RANGE_ERROR_BAD_SEQUENCE",
}

type BlocksByRangeErrorType =
  | {code: BlocksByRangeErrorCode.BAD_LENGTH; count: number; length: number}
  | {code: BlocksByRangeErrorCode.UNDER_START_SLOT; startSlot: number; firstSlot: number}
  | {code: BlocksByRangeErrorCode.OVER_MAX_SLOT; maxSlot: number; lastSlot: number}
  | {code: BlocksByRangeErrorCode.BAD_SEQUENCE; step: number; slotL: number; slotR: number};

export class BlocksByRangeError extends LodestarError<BlocksByRangeErrorType> {}
