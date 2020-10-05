import {SyncingStatus} from "@chainsafe/lodestar-types";

export interface INodeApi {
  getVersion(): Promise<string>;
  getSyncingStatus(): Promise<SyncingStatus>;
}
