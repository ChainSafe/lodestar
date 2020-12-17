import {BeaconState, SlotRoot} from "@chainsafe/lodestar-types";
import {StateId} from "../../beacon/state";

export interface IDebugBeaconApi {
  /**
   * API wrapper function for `getHeads` in `@chainsafe/lodestar-fork-choice`.
   * */
  getHeads(): Promise<SlotRoot[] | null>;
  getState(stateId: StateId): Promise<BeaconState | null>;
}
