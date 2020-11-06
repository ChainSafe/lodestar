import {BLSPubkey, Fork, Genesis, ValidatorIndex, ValidatorResponse} from "@chainsafe/lodestar-types";

export interface IBeaconApi {
  state: IBeaconStateApi;

  getGenesis(): Promise<Genesis | null>;
}

export interface IBeaconStateApi {
  getFork(stateId: "head"): Promise<Fork | null>;
  getStateValidator(stateId: "head", validatorId: ValidatorIndex | BLSPubkey): Promise<ValidatorResponse | null>;
}
