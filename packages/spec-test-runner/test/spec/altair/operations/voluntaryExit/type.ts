import {altair, phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessVoluntaryExitTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  voluntary_exit: phase0.SignedVoluntaryExit;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
