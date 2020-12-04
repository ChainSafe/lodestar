import {AttesterSlashing, BeaconState} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessAttesterSlashingTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  attester_slashing: AttesterSlashing;
  pre: BeaconState;
  post?: BeaconState;
}
