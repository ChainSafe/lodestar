import {phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IStateTestCase extends IBaseSpecTest {
  pre: phase0.BeaconState;
  post: phase0.BeaconState;
}
