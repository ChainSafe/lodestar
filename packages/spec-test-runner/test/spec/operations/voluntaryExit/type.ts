import {BeaconState, VoluntaryExit} from "@chainsafe/eth2.0-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessVoluntaryExitTestCase extends IBaseSpecTest {

  voluntary_exit: VoluntaryExit;
  pre: BeaconState;
  post?: BeaconState;

}