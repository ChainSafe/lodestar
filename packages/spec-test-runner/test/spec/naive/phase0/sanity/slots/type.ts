import {phase0, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../../type";

export interface IProcessSlotsTestCase extends IBaseSpecTest {
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
  slots: Uint64;
}
