import {BeaconState, Uint64} from "@chainsafe/lodestar-types";

export interface ProcessSlotsTestCase {
  pre: BeaconState;
  post?: BeaconState;
  slots: Uint64;
}
