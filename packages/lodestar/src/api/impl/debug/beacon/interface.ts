import {SlotRoot} from "@chainsafe/lodestar-types";

export interface IDebugBeaconApi {
  /**
   * API wrapper function for `getHeads` in `@chainsafe/lodestar-fork-choice`.
   * */
  getHeads(): Promise<SlotRoot[] | null>;
}
