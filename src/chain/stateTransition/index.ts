import {
  BeaconBlock,
  BeaconState,
} from "../../types";

import processBlock from "./block";
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
  
  if (block) {
    processBlock(state, block);
  }

  if (shouldProcessEpoch(state)) {
    processEpoch(state);
  }

  return state;
}
