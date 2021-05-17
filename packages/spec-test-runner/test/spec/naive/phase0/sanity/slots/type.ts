import {phase0, Uint64} from "@chainsafe/lodestar-types";

export interface IProcessSlotsTestCase {
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
  slots: Uint64;
}
