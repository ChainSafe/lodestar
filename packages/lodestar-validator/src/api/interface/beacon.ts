import {BLSPubkey, Fork, Genesis, Root, Uint64, ValidatorResponse} from "@chainsafe/lodestar-types";

export interface IBeaconApi {

  /**
     * Requests the BeaconNode to provide which fork version it is currently on.
     */
  getFork(): Promise<{fork: Fork; chainId: Uint64; genesisValidatorsRoot: Root}>;

  /**
     * Requests the BeaconNode to provide validator details for given public key.
     */
  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null>;

  getGenesis(): Promise<Genesis|null>;

}
