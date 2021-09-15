import {merge} from "@chainsafe/lodestar-types";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {IBaseSpecTest} from "../type";

export interface IMergeStateTestCase extends IBaseSpecTest {
  pre: merge.BeaconState;
  post: merge.BeaconState;
}

/** Config with `ALTAIR_FORK_EPOCH: 0` */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const config = createIChainForkConfig({ALTAIR_FORK_EPOCH: 0, MERGE_FORK_EPOCH: 0});
