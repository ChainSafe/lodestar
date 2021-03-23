import {BLSPubkey, ValidatorIndex, phase0} from "@chainsafe/lodestar-types";
// import { IValidatorFilters } from "@chainsafe/lodestar/src/api/impl/beacon/state";

export interface IBeaconApi {
  state: IBeaconStateApi;
  blocks: IBeaconBlocksApi;
  pool: IBeaconPoolApi;

  getGenesis(): Promise<phase0.Genesis | null>;
}

export interface IBeaconStateApi {
  getFork(stateId: "head"): Promise<phase0.Fork | null>;
  getStateValidator(stateId: "head", validatorId: ValidatorIndex | BLSPubkey): Promise<phase0.ValidatorResponse | null>;
  getStateValidators(stateId: "head", filters?: string[]): Promise<phase0.ValidatorResponse[] | null>;
}

export interface IBeaconBlocksApi {
  publishBlock(block: phase0.SignedBeaconBlock): Promise<void>;
}

export interface IBeaconPoolApi {
  submitAttestation(attestation: phase0.Attestation): Promise<void>;
  submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void>;
}
