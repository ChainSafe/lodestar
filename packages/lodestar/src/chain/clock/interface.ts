import {Epoch, Slot} from "@chainsafe/lodestar-types";

/**
 * Tracks the current chain time, measured in `Slot`s and `Epoch`s
 *
 * The time is dependant on:
 * - `state.genesisTime` - the genesis time
 * - `SECONDS_PER_SLOT` - # of seconds per slot
 * - `SLOTS_PER_EPOCH` - # of slots per epoch
 */
export interface IBeaconClock {
  readonly currentSlot: Slot;
  /**
   * Max current slot of peers.
   * If it's too close to next slot, maxCurrentSlot = currentSlot + 1
   */
  readonly maxPeerCurrentSlot: Slot;
  readonly currentEpoch: Epoch;
  /**
   * Returns a promise that waits until at least `slot` is reached
   * Resolves when the current slot >= `slot`
   * Rejects if the clock is aborted
   */
  waitForSlot(slot: Slot): Promise<void>;
}
