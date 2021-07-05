import {altair, phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IUpgradeStateCase extends IBaseSpecTest {
  pre: phase0.BeaconState;
  post: altair.BeaconState;
}
