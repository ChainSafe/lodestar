import {altair, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IBlockSanityTestCase extends IBaseSpecTest {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: altair.BeaconState;
  post: altair.BeaconState;
}
