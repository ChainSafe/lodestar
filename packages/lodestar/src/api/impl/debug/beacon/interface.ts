import {phase0} from "@chainsafe/lodestar-types";
import {StateId} from "../../beacon/state";

export interface IDebugBeaconApi {
  /**
   * API wrapper function for `getHeads` in `@chainsafe/lodestar-fork-choice`.
   * */
  getHeads(): Promise<phase0.SlotRoot[] | null>;
  getState(stateId: StateId): Promise<phase0.BeaconState | null>;
}
