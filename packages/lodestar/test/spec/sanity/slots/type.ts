import {BeaconState, uint64} from "@chainsafe/eth2.0-types";

export interface ProcessSlotsTestCase {
  pre: BeaconState;
  post?: BeaconState;
  slots: uint64;
}