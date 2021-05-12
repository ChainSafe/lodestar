import {altair, Uint64} from "@chainsafe/lodestar-types";

export interface IProcessSlotsTestCase {
  pre: altair.BeaconState;
  post?: altair.BeaconState;
  slots: Uint64;
}
