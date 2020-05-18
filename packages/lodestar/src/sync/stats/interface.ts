import {IService} from "../../node";
import {Slot} from "@chainsafe/lodestar-types";

export interface ISyncStats extends IService{
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
