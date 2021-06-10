import {altair, ssz} from "@chainsafe/lodestar-types";
import {VectorType} from "@chainsafe/ssz";
import {IBaseSpecTest} from "../../type";

export const Deltas = new VectorType<bigint[]>({
  elementType: ssz.altair.BeaconState.fields.balances,
  length: 2,
});

export interface RewardTestCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  head_deltas: bigint[][];
  source_deltas: bigint[][];
  target_deltas: bigint[][];
  inactivity_penalty_deltas: bigint[][];
}

export type Output = {
  head_deltas: bigint[][];
  source_deltas: bigint[][];
  target_deltas: bigint[][];
  inactivity_penalty_deltas: bigint[][];
};
