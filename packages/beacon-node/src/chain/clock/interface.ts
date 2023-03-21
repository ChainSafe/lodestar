import {Epoch, Slot} from "@lodestar/types";

/**
 * Tracks the current chain time, measured in `Slot`s and `Epoch`s
 *
 * The time is dependant on:
 * - `state.genesisTime` - the genesis time
 * - `SECONDS_PER_SLOT` - # of seconds per slot
 * - `SLOTS_PER_EPOCH` - # of slots per epoch
 */
export type BeaconClock = {
  readonly currentSlot: Slot;
  /**
   * If it's too close to next slot, maxCurrentSlot = currentSlot + 1
   */
  readonly currentSlotWithGossipDisparity: Slot;
  readonly currentEpoch: Epoch;
  /** Returns the slot if the internal clock were advanced by `toleranceSec`. */
  slotWithFutureTolerance(toleranceSec: number): Slot;
  /** Returns the slot if the internal clock were reversed by `toleranceSec`. */
  slotWithPastTolerance(toleranceSec: number): Slot;
  /**
   * Check if a slot is current slot given MAXIMUM_GOSSIP_CLOCK_DISPARITY.
   */
  isCurrentSlotGivenGossipDisparity(slot: Slot): boolean;
  /**
   * Returns a promise that waits until at least `slot` is reached
   * Resolves when the current slot >= `slot`
   * Rejects if the clock is aborted
   */
  waitForSlot(slot: Slot): Promise<void>;
  /**
   * Return second from a slot to either toSec or now.
   */
  secFromSlot(slot: Slot, toSec?: number): number;
};
