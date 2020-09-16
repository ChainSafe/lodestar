import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {ZERO_HASH} from "../../src/constants";

export function getBlockSummary(overide: Partial<IBlockSummary>): IBlockSummary {
  return {
    slot: 0,
    blockRoot: ZERO_HASH,
    parentRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    targetRoot: ZERO_HASH,
    finalizedEpoch: 0,
    justifiedEpoch: 0,
    ...overide,
  };
}
