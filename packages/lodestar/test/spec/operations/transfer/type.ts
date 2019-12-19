import {BeaconState, Transfer} from "@chainsafe/eth2.0-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessTransferTestCase extends IBaseSpecTest {

  transfer: Transfer;
  pre: BeaconState;
  post?: BeaconState;

}