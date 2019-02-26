import {
  BeaconBlock,
  BeaconState,
  bytes32,
} from "../types";

import {processSlot} from "./processSlot";
import processBlock from "./block";
import {processEpoch} from "./processEpoch";

export {
  processSlot,
  processBlock,
  processEpoch,
}

export function executeStateTransition(state: BeaconState, block: BeaconBlock, prevBlockRoot: bytes32): BeaconState {
  processSlot(state, prevBlockRoot);
  processBlock(state, block);
  processEpoch(state);
  return state;
}
