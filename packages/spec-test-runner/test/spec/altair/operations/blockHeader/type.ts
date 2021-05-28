import {altair} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessBlockHeader extends IBaseSpecTest {
  block: altair.BeaconBlock;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
