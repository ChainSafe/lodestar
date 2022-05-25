import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Slot, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconClock} from "../../src/chain/clock/index.js";

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

  secFromSlot(slot: number, toSec?: number): number {
    // SECONDS_PER_SLOT = 6 in minimal config
    return (toSec ?? Date.now() / 1000) - slot * 6;
  }
}
