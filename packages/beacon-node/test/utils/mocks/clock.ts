import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {BeaconClock} from "../../../src/chain/index.js";

/**
 * Mock clock that does not progress time unless calling setSlot()
 */
export class ClockStopped implements BeaconClock {
  constructor(private slot: Slot) {}

  get currentSlot(): Slot {
    return this.slot;
  }

  /** If it's too close to next slot, maxCurrentSlot = currentSlot + 1 */
  get currentSlotWithGossipDisparity(): Slot {
    return this.slot;
  }

  get currentEpoch(): Epoch {
    return computeEpochAtSlot(this.slot);
  }

  slotWithFutureTolerance(): Slot {
    return this.slot;
  }
  slotWithPastTolerance(): Slot {
    return this.slot;
  }

  /**
   * Check if a slot is current slot given MAXIMUM_GOSSIP_CLOCK_DISPARITY.
   */
  isCurrentSlotGivenGossipDisparity(slot: Slot): boolean {
    return slot === this.slot;
  }

  /**
   * Returns a promise that waits until at least `slot` is reached
   * Resolves when the current slot >= `slot`
   * Rejects if the clock is aborted
   */
  async waitForSlot(): Promise<void> {
    // Not used
  }

  /**
   * Return second from a slot to either toSec or now.
   */
  secFromSlot(): number {
    return 0;
  }

  // MOCK Methods

  setSlot(slot: Slot): void {
    this.slot = slot;
  }
}
