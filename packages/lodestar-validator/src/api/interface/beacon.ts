import {Attestation, BLSPubkey, Fork, Genesis, ValidatorIndex, ValidatorResponse} from "@chainsafe/lodestar-types";
import {SignedBeaconBlockType} from "@chainsafe/lodestar-utils";

export interface IBeaconApi {
  state: IBeaconStateApi;
  blocks: IBeaconBlocksApi;
  pool: IBeaconPoolApi;

  getGenesis(): Promise<Genesis | null>;
}

export interface IBeaconStateApi {
  getFork(stateId: "head"): Promise<Fork | null>;
  getStateValidator(stateId: "head", validatorId: ValidatorIndex | BLSPubkey): Promise<ValidatorResponse | null>;
}

export interface IBeaconBlocksApi {
  publishBlock(block: SignedBeaconBlockType): Promise<void>;
}

export interface IBeaconPoolApi {
  submitAttestation(attestation: Attestation): Promise<void>;
}
