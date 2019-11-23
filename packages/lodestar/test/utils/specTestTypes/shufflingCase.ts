import {BaseCase} from "@chainsafe/eth2.0-spec-test-util";

export interface ShufflingCase extends BaseCase {
  seed: string;
  count: bigint;
  shuffled: bigint[];
}