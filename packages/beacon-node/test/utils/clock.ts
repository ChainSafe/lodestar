import EventEmitter from "node:events";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot, Epoch} from "@lodestar/types";
import {IClock} from "../../src/util/clock.js";

export class ClockStatic extends EventEmitter implements IClock {
  constructor(
    readonly currentSlot: Slot,
    public genesisTime = 0
  ) {
    super();
  }

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
