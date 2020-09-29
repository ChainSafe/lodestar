import {BeaconState, SignedBeaconBlock, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../type";

export interface IFinalityTestCase extends IBaseSpecTest {
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: BeaconState;
  post: BeaconState;
  [k: string]: SignedBeaconBlock | unknown | null | undefined;
}
