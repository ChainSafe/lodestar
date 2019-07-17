/**
 * @module chain/stateTransition
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
} from "@chainsafe/eth2-types";
import {IBeaconConfig} from "../../config";

import {processBlock} from "./block";
import {processEpoch} from "./epoch";
import {processSlots} from "./slot";

export {
  processSlots,
  processBlock,
  processEpoch,
};

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#beacon-chain-state-transition-function

export function stateTransition(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  validateStateRoot = false,
  verifySignatures = true
): BeaconState {
  // Process slots (including those with no blocks) since block
  processSlots(config, state, block.slot);
  // Process block
  processBlock(config, state, block, verifySignatures);
  // Validate state root (`validate_state_root == True` in production)
  if (validateStateRoot){
    assert(block.stateRoot.equals(hashTreeRoot(state, config.types.BeaconState)));
  }

  // Return post-state
  return state;
}
