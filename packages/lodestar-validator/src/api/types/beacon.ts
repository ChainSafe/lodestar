import {BLSPubkey, Fork, Genesis, ValidatorResponse} from "@chainsafe/lodestar-types";

export interface IBeaconApiClient {
  getFork(): Promise<Fork | null>;
  /**
   * Requests the BeaconNode to provide validator details for given public key.
   */
  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null>;

  getGenesis(): Promise<Genesis | null>;
}
