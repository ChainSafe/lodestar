import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessBlockHeader extends IBaseSpecTest {

  block: BeaconBlock;
  pre: BeaconState;
  post?: BeaconState;

}