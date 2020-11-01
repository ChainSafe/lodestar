/**
 * @module api/rpc
 */

import {BLSPubkey, ForkResponse, Genesis, SignedBeaconBlock, ValidatorResponse} from "@chainsafe/lodestar-types";
import {IBeaconBlocksApi} from "./blocks";
import {IBeaconPoolApi} from "./pool";
import {IBeaconStateApi} from "./state/interface";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";

export interface IBeaconApi {
  blocks: IBeaconBlocksApi;
  state: IBeaconStateApi;
  pool: IBeaconPoolApi;

  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null>;

  getGenesis(): Promise<Genesis | null>;

  getBlockStream(): IStoppableEventIterable<SignedBeaconBlock>;
}
