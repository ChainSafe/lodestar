import {phase0} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {IBaseSpecTest} from "../type";

export interface IPhase0StateTestCase extends IBaseSpecTest {
  pre: phase0.BeaconState;
  post: phase0.BeaconState;
}

export {config};
