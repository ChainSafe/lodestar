import {Slot} from "@chainsafe/lodestar-types";

export interface ISyncStats {
  start(): void;
  stop(): void;

  /**
   * Returns blocks per second processing
   */
  getSyncSpeed(): number;

  /**
   * Estimate how much time (in seconds) will take to sync to target.
   * @param headSlot
   * @param targetSlot
   */
  getEstimate(headSlot: Slot, targetSlot: Slot): number;
}
