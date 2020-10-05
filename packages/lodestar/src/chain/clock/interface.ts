import {Epoch, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconClock {
  readonly currentSlot: Slot;
  readonly currentEpoch: Epoch;
  /**
   * Returns a promise that waits until at least `slot` is reached
   * Resolves when the current slot >= `slot`
   * Rejects if the clock is aborted
   */
  waitForSlot(slot: Slot): Promise<void>;
}
