import {AttesterSlashing, BeaconState} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessAttesterSlashingTestCase extends IBaseSpecTest {

  attester_slashing: AttesterSlashing;
  pre: BeaconState;
  post?: BeaconState;
}