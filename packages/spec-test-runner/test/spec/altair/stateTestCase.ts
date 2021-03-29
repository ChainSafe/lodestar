import {altair} from "@chainsafe/lodestar-types";

export interface IAltairStateTestCase {
  pre: altair.BeaconState;
  post: altair.BeaconState;
}
