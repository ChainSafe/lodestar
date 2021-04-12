/**
 * @module api/rpc
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {IBeaconBlocksApi} from "./blocks";
import {IBeaconPoolApi} from "./pool";
import {IBeaconStateApi} from "./state/interface";

export interface IBeaconApi {
  blocks: IBeaconBlocksApi;
  state: IBeaconStateApi;
  pool: IBeaconPoolApi;
  getGenesis(): Promise<phase0.Genesis>;
  getBlockStream(): IStoppableEventIterable<phase0.SignedBeaconBlock>;
}
