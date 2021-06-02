import {altair, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessSlotsTestCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  post?: altair.BeaconState;
  slots: Uint64;
}
