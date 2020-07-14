/**
 * @module api/rpc
 */

import {IApi} from "../../interface";
import {BLSPubkey, ForkResponse, Genesis, SignedBeaconBlock, ValidatorResponse} from "@chainsafe/lodestar-types";
import {LodestarEventIterator} from "../../../util/events";
import {IBeaconBlocksApi} from "./blocks";
import {IBeaconPoolApi} from "./pool";

export interface IBeaconApi extends IApi {

  blocks: IBeaconBlocksApi;
  pool: IBeaconPoolApi;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   */
  getFork(): Promise<ForkResponse>;

  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null>;

  getGenesis(): Promise<Genesis|null>;

  getBlockStream(): LodestarEventIterator<SignedBeaconBlock>;
}
