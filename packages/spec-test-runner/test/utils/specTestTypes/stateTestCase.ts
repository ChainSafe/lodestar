import {BeaconState} from "@chainsafe/eth2.0-types";

export interface StateTestCase {
  pre: BeaconState;
  post: BeaconState;
}