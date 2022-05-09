import {bellatrix} from "@chainsafe/lodestar-types";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {IBaseSpecTest} from "../type";

export interface IBellatrixStateTestCase extends IBaseSpecTest {
  pre: bellatrix.BeaconState;
  post: bellatrix.BeaconState;
}

/** Config with `ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0` */
export const config = createIChainForkConfig({
  /* eslint-disable @typescript-eslint/naming-convention */
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("115792089237316195423570985008687907853269984665640564039457584007913129638912"),
});
