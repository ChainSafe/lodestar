import {BeaconState} from "@chainsafe/lodestar-types";

export interface IStateTestCase {
  pre: BeaconState;
  post: BeaconState;
}
