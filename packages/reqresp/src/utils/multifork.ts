import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";

const SLOT_BYTES_POSITION_IN_BLOCK = 100;
const SLOT_BYTE_COUNT = 8;

export function getSlotFromBytes(bytes: Buffer | Uint8Array): Slot {
  return bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_BLOCK, SLOT_BYTES_POSITION_IN_BLOCK + SLOT_BYTE_COUNT));
}
