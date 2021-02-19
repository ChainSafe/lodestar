import {phase0} from "@chainsafe/lodestar-types";

export interface IStateTestCase {
  pre: phase0.BeaconState;
  post: phase0.BeaconState;
}
