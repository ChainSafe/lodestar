import {BeaconBlock, BeaconState, uint64} from "@chainsafe/eth2.0-types";
import {IBaseSpecTest} from "../../type";

export interface IBlockSanityTestCase extends IBaseSpecTest{
  meta: {
    blocksCount: uint64;
    blsSetting: BigInt;
  };
  pre: BeaconState;
  post: BeaconState;
  [k: string]: BeaconBlock|unknown|null|undefined;
}