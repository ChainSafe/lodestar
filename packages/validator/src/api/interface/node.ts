import {phase0} from "@chainsafe/lodestar-types";

export interface INodeApi {
  getVersion(): Promise<string>;
  getSyncingStatus(): Promise<phase0.SyncingStatus>;
}
