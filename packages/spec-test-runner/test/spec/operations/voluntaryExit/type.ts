import {BeaconState, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessVoluntaryExitTestCase extends IBaseSpecTest {

  voluntary_exit: SignedVoluntaryExit;
  pre: BeaconState;
  post?: BeaconState;

}
