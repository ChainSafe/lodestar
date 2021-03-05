import {lightclient, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IBlockSanityTestCase extends IBaseSpecTest {
  [k: string]: lightclient.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: lightclient.BeaconState;
  post: lightclient.BeaconState;
}
