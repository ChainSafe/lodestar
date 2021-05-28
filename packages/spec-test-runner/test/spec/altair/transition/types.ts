import {ForkName} from "@chainsafe/lodestar-config";
import {altair, phase0, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface ITransitionTestCase extends IBaseSpecTest {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    postFork: ForkName;
    forkEpoch: phase0.Epoch;
    forkBlock: Uint64;
    blocksCount: Uint64;
  };
  pre: phase0.BeaconState;
  post: altair.BeaconState;
}
