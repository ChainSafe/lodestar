import {BLSPubkey, Fork, Number64, Root, Uint64, ValidatorResponse} from "@chainsafe/lodestar-types";

export interface IBeaconApi {

  /**
     * Requests the BeaconNode to provide which fork version it is currently on.
     */
  getFork(): Promise<{fork: Fork; chainId: Uint64; genesisValidatorsRoot: Root}>;

  /**
     * Requests the BeaconNode to provide validator details for given public key.
     */
  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null>;

  /**
     * Requests the genesis_time parameter from the BeaconNode,
     * which should be consistent across all BeaconNodes that follow the same beacon chain.
     * @returns The genesis_time,
     * which is a fairly static configuration option for the BeaconNode.
     */
  getGenesisTime(): Promise<Number64>;

}
