import {BLSPubkey, Fork, Genesis, ValidatorResponse, SignedBeaconBlock, Attestation} from "@chainsafe/lodestar-types";

export interface IBeaconApi {
  state: IBeaconStateApi;
  blocks: IBeaconBlocksApi;
  pool: IBeaconPoolApi;

  /**
   * Requests the BeaconNode to provide validator details for given public key.
   */
  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null>;

  getGenesis(): Promise<Genesis | null>;
}

export interface IBeaconStateApi {
  getFork(stateId: "head"): Promise<Fork | null>;
}

export interface IBeaconBlocksApi {
  publishBlock(block: SignedBeaconBlock): Promise<void>;
}

export interface IBeaconPoolApi {
  submitAttestation(attestation: Attestation): Promise<void>;
}
