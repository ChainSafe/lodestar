import {BeaconState, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessVoluntaryExitTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  voluntary_exit: SignedVoluntaryExit;
  pre: BeaconState;
  post?: BeaconState;
}
