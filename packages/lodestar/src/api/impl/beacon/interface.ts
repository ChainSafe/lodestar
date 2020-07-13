/**
 * @module api/rpc
 */

import {IApi} from "../../interface";
import {BLSPubkey, ForkResponse, Number64, SignedBeaconBlock, ValidatorResponse} from "@chainsafe/lodestar-types";
import {LodestarEventIterator} from "../../../util/events";
import {IBeaconBlocksApi} from "./blocks";

export interface IBeaconApi extends IApi {

  blocks: IBeaconBlocksApi;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   */
  getFork(): Promise<ForkResponse>;

  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null>;

  /**
   * Requests the genesis_time parameter from the BeaconNode,
   * which should be consistent across all BeaconNodes that follow the same beacon chain.
   * @returns The genesis_time,
   * which is a fairly static configuration option for the BeaconNode.
   */
  getGenesisTime(): Promise<Number64>;

  getBlockStream(): LodestarEventIterator<SignedBeaconBlock>;
}
