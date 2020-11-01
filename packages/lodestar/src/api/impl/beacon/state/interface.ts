import {BeaconState, Fork} from "@chainsafe/lodestar-types";

export interface IBeaconStateApi {
  getState(stateId: StateId): Promise<BeaconState | null>;
  getFork(stateId: StateId): Promise<Fork | null>;
}

export type StateId = string | "head" | "genesis" | "finalized" | "justified";
