import {BlockSummary} from "../../src/chain/forkChoice";
import {ZERO_HASH} from "../../src/constants";

export function getBlockSummary(overide: Partial<BlockSummary>): BlockSummary {
  return {
    blockRoot: ZERO_HASH,
    parentRoot: ZERO_HASH,
    slot: 0,
    stateRoot: ZERO_HASH,
    finalizedCheckpoint: {
      epoch: 0,
      root: ZERO_HASH
    },
    justifiedCheckpoint: {
      epoch: 0,
      root: ZERO_HASH
    },
    ...overide
  };
}
