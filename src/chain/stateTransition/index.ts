/**
 * @module chain/stateTransition
 */

import {
  BeaconBlock,
  BeaconState,
} from "../../types";

import {processBlock} from "./block";
import {processEpoch, shouldProcessEpoch} from "./epoch";
import {advanceSlot, cacheState} from "./slot";

export {
  advanceSlot,
  cacheState,
  processBlock,
  processEpoch,
};

export function executeStateTransition(state: BeaconState, block: BeaconBlock | null, verifyStateRoot = true): BeaconState {

  if (block) {
    while(state.slot < block.slot) {
      cacheState(state);
      if (shouldProcessEpoch(state)) {
        processEpoch(state);
      }
      advanceSlot(state);
    }
    processBlock(state, block, verifyStateRoot);
  } else {
    cacheState(state);
    if (shouldProcessEpoch(state)) {
      processEpoch(state);
    }
    advanceSlot(state);
  }


  return state;
}
