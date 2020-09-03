/**
 * @module api/rpc
 */

import {BLSPubkey, ForkResponse, Genesis, SignedBeaconBlock, ValidatorResponse} from "@chainsafe/lodestar-types";

import {LodestarEventIterator} from "../../../util/events";
import {IBeaconBlocksApi} from "./blocks";
import {IBeaconPoolApi} from "./pool";
import {IBeaconStateApi} from "./state/interface";

export interface IBeaconApi {
  blocks: IBeaconBlocksApi;
  state: IBeaconStateApi;
  pool: IBeaconPoolApi;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   */
  getFork(): Promise<ForkResponse>;

  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null>;

  getGenesis(): Promise<Genesis | null>;

  getBlockStream(): LodestarEventIterator<SignedBeaconBlock>;
}
