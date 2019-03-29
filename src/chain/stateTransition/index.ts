import {
  BeaconBlock,
  BeaconState,
  bytes32,
} from "../../types";

import processBlock from "./block";
import { processEpoch, shouldProcessEpoch } from "./epoch";
import {processSlot} from "./slot";

export {
  processSlot,
  processBlock,
  processEpoch,
};

export function executeStateTransition(state: BeaconState, block: BeaconBlock | null, prevBlockRoot: bytes32): BeaconState {
  processSlot(state, prevBlockRoot);
  
  if (block) {
    processBlock(state, block);
  }

  if (shouldProcessEpoch(state)) {
    processEpoch(state);
  }

  return state;
}
