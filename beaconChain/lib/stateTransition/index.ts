import {
  bool,
  BeaconBlock,
  BeaconState,
  bytes32,
} from "../../types";

import {processSlot} from "./processSlot";
import {processBlock} from "./processBlock";
import {processEpoch} from "./processEpoch";

export {
  processSlot,
  processBlock,
  processEpoch,
}

export function executeStateTransition(state: BeaconState, block: BeaconBlock, prevBlockRoot: bytes32, verifySignatures: bool): BeaconState {
  return processEpoch(processBlock(processSlot(state, prevBlockRoot), block, verifySignatures))
}
