import {phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessAttesterSlashingTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  attester_slashing: phase0.AttesterSlashing;
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
}
