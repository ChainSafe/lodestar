import {BeaconState, Uint64, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {IBaseSpecTest} from "../../type";

export interface IBlockSanityTestCase extends IBaseSpecTest{
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: BeaconState;
  post: BeaconState;
  [k: string]: SignedBeaconBlock|unknown|null|undefined;
}
