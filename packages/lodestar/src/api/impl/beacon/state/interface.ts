import {BeaconState} from "@chainsafe/lodestar-types";

export interface IBeaconStateApi {
  getState(stateId: StateId): Promise<BeaconState | null>;
}

export type StateId = string | "head" | "genesis" | "finalized" | "justified";
