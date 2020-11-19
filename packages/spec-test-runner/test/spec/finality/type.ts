import {BeaconState, SignedBeaconBlock, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../type";

export interface IFinalityTestCase extends IBaseSpecTest {
  [k: string]: SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: BeaconState;
  post: BeaconState;
}
