import {
  BLSPubkey,
  Fork,
  Genesis,
  ValidatorResponse,
  ValidatorIndex,
  SignedBeaconBlock,
  Attestation,
} from "@chainsafe/lodestar-types";

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
  publishBlock(block: SignedBeaconBlock): Promise<void>;
}

export interface IBeaconPoolApi {
  submitAttestation(attestation: Attestation): Promise<void>;
}
