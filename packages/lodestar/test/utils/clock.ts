import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Slot, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconClock} from "../../src/chain/clock";

export class ClockStatic implements IBeaconClock {
  constructor(readonly currentSlot: Slot) {}

  get currentEpoch(): Epoch {
    return computeEpochAtSlot(this.currentSlot);
  }

  get currentSlotWithGossipDisparity(): Slot {
    return this.currentSlot;
  }

  slotWithFutureTolerance(): Slot {
    return this.currentSlot;
  }

  slotWithPastTolerance(): Slot {
    return this.currentSlot;
  }

  isCurrentSlotGivenGossipDisparity(slot: Slot): boolean {
    return this.currentSlot === slot;
  }

  async waitForSlot(): Promise<void> {
    //
  }
}
