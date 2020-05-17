import {Gwei} from "@chainsafe/lodestar-types";

export interface IEpochStakeSummary {
  sourceStake: Gwei;
  targetStake: Gwei;
  headStake: Gwei;
}
