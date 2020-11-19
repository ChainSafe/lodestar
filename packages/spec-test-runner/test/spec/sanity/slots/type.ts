import {BeaconState, Uint64} from "@chainsafe/lodestar-types";

export interface IProcessSlotsTestCase {
  pre: BeaconState;
  post?: BeaconState;
  slots: Uint64;
}
