import {IBaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface IShufflingCase extends IBaseCase {
  seed: string;
  count: bigint;
  shuffled: bigint[];
}
