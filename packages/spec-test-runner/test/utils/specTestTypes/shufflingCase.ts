import {BaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface ShufflingCase extends BaseCase {
  seed: string;
  count: bigint;
  shuffled: bigint[];
}