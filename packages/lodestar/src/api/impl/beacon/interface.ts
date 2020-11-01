/**
 * @module api/rpc
 */

import {BLSPubkey, Genesis, SignedBeaconBlock, ValidatorResponse} from "@chainsafe/lodestar-types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {IBeaconBlocksApi} from "./blocks";
import {IBeaconPoolApi} from "./pool";
import {IBeaconStateApi} from "./state/interface";

export interface IBeaconApi {
  blocks: IBeaconBlocksApi;
  state: IBeaconStateApi;
  pool: IBeaconPoolApi;

  getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse | null>;

  getGenesis(): Promise<Genesis | null>;

  getBlockStream(): IStoppableEventIterable<SignedBeaconBlock>;
}
