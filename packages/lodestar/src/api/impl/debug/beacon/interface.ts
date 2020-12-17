import {BeaconState, SlotRoot} from "@chainsafe/lodestar-types";
import {StateId} from "../../beacon/state";

export interface IDebugBeaconApi {
  getHeads(): Promise<SlotRoot[] | null>;
  getState(stateId: StateId): Promise<BeaconState | null>;
}
