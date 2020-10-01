import {BLSPubkey, Fork, Genesis, ValidatorResponse} from "@chainsafe/lodestar-types";

export interface IBeaconApi {
  state: {
    getFork: (stateId: "head") => Promise<Fork | null>;
  };

  /**
   * Requests the BeaconNode to provide validator details for given public key.
   */
  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null>;

  getGenesis(): Promise<Genesis | null>;
}
