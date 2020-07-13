/**
 * @module api/rpc
 */

import {IApi} from "../../interface";
import {
  BLSPubkey,
  ForkResponse,
  Genesis,
  Number64,
  SignedBeaconBlock,
  ValidatorResponse
} from "@chainsafe/lodestar-types";
import {LodestarEventIterator} from "../../../util/events";
import {IBeaconBlocksApi} from "./blocks";

export interface IBeaconApi extends IApi {

  blocks: IBeaconBlocksApi;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   */
  getFork(): Promise<ForkResponse>;

  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null>;

  getGenesis(): Promise<Genesis|null>;

  getBlockStream(): LodestarEventIterator<SignedBeaconBlock>;
}
