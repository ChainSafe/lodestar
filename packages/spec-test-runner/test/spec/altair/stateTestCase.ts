import {altair} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../type";

export interface IAltairStateTestCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  post: altair.BeaconState;
}
