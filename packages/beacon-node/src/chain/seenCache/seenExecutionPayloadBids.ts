import {BuilderIndex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

/**
 * Tracks execution payload bids we've already seen per (slot, builder).
 */
export class SeenExecutionPayloadBids {
  private readonly builderIndexesBySlot = new MapDef<Slot, Set<BuilderIndex>>(() => new Set<BuilderIndex>());
  private lowestPermissibleSlot: Slot = 0;

  isKnown(slot: Slot, builderIndex: BuilderIndex): boolean {
    return this.builderIndexesBySlot.get(slot)?.has(builderIndex) === true;
  }

  add(slot: Slot, builderIndex: BuilderIndex): void {
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`slot ${slot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    this.builderIndexesBySlot.getOrDefault(slot).add(builderIndex);
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.builderIndexesBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.builderIndexesBySlot.delete(slot);
      }
    }
  }
}
