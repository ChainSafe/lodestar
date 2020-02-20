import {BeaconState, Uint64} from "@chainsafe/eth2.0-types";

export interface ProcessSlotsTestCase {
  pre: BeaconState;
  post?: BeaconState;
  slots: Uint64;
}
