import {BeaconState} from "@chainsafe/lodestar-types";

export interface StateTestCase {
  pre: BeaconState;
  post: BeaconState;
}