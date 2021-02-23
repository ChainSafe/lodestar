import {phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessBlockHeader extends IBaseSpecTest {
  block: phase0.BeaconBlock;
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
}
