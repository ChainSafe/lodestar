import {altair} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessSyncCommitteeTestCase extends IBaseSpecTest {
  "sync_aggregate": altair.SyncAggregate;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
