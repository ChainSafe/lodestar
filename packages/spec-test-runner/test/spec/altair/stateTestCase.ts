import {altair} from "@chainsafe/lodestar-types";

export interface ILightclientStateTestCase {
  pre: altair.BeaconState;
  post: altair.BeaconState;
}
