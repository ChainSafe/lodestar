import {BeaconBlock, BeaconState} from "@chainsafe/eth2.0-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessBlockHeader extends IBaseSpecTest {

  block: BeaconBlock;
  pre: BeaconState;
  post?: BeaconState;

}