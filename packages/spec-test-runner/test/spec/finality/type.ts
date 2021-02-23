import {phase0, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../type";

export interface IFinalityTestCase extends IBaseSpecTest {
  [k: string]: phase0.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: phase0.BeaconState;
  post: phase0.BeaconState;
}
