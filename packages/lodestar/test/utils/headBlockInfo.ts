import {BlockHeadInfo} from "../../src/chain/forkChoice";
import {ZERO_HASH} from "../../src/constants";

export function getBlockHeadInfo(overide: Partial<BlockHeadInfo>): BlockHeadInfo {
  return {
    blockRootBuf: ZERO_HASH,
    parentRootBuf: ZERO_HASH,
    slot: 0,
    stateRootBuf: ZERO_HASH,
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
