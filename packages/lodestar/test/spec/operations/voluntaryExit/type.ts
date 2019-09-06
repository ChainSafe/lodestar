import {BeaconState, VoluntaryExit} from "@chainsafe/eth2.0-types";

export interface ProcessVoluntaryExitTestCase {

  voluntary_exit: VoluntaryExit;
  pre: BeaconState;
  post?: BeaconState;

}