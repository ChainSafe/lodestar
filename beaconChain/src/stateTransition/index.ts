import {
  BeaconBlock,
  BeaconState,
  bytes32,
} from "../types";

import processBlock from "./block";
import {processEpoch} from "./epoch";
import {processSlot} from "./slot";

export {
  processSlot,
  processBlock,
  processEpoch,
};

export function executeStateTransition(state: BeaconState, block: BeaconBlock, prevBlockRoot: bytes32): BeaconState {
  processSlot(state, prevBlockRoot);
  processBlock(state, block);
  processEpoch(state);
  return state;
}
