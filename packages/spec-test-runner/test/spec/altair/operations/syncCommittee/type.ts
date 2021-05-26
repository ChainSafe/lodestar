import {altair} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessSyncCommitteeTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  sync_aggregate: altair.SyncAggregate;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
