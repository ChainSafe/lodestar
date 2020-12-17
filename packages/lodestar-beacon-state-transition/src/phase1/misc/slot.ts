import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Slot} from "@chainsafe/lodestar-types";

export function computePreviousSlot(slot: Slot): Slot {
  if (slot > 0) {
    return slot - 1;
  }
  return 0;
}

export function computeOffsetSlots(config: IBeaconConfig, startSlot: Slot, endslot: Slot): Slot[] {
  const slots = [];
  for (const x of config.params.phase1.SHARD_BLOCK_OFFSETS) {
    if (startSlot + x < endslot) {
      slots.push(startSlot + x);
    }
  }
  return slots;
}
