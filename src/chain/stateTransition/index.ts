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

export function executeStateTransition(state: BeaconState, block: BeaconBlock | null): BeaconState {
  cacheState(state);
  advanceSlot(state);
  if (shouldProcessEpoch(state)) {
    processEpoch(state);
  }

  if (block) {
    while(state.slot < block.slot) {
      cacheState(state);
      advanceSlot(state);
      if (shouldProcessEpoch(state)) {
        processEpoch(state);
      }
    }
    processBlock(state, block);
  }


  return state;
}
