/**
 * @module chain/stateTransition
 */

import assert from "assert";
import {hashTreeRoot, clone} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {processBlock} from "./block";
import {processSlots} from "./slot";

export * from "./util";
export * from "./epoch";
export * from "./block";
export * from "./slot";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1
// /specs/core/0_beacon-chain.md#beacon-chain-state-transition-function

/**
 * The ETH2.0 Beacon Chain state transition function
 * @param config Beacon Chain configuration
 * @param state Current state
 * @param block Block being processed
 * @param validateStateRoot Compare state root at the end of state execution
 * @param verifyProposer Skip block proposer signature verification
 * @param verifySignatures Skip operations signature verification
 */
export function stateTransition(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
  validateStateRoot = false,
  verifyProposer = true,
  verifySignatures = true
): BeaconState {
  // Clone state because process slots and block are not pure
  const postState = clone(config.types.BeaconState, state);
  // Process slots (including those with no blocks) since block
  processSlots(config, postState, block.slot);
  // Process block
  processBlock(config, postState, block, verifyProposer, verifySignatures);
  // Validate state root (`validate_state_root == True` in production)
  if (validateStateRoot){
    assert(block.stateRoot.equals(hashTreeRoot(config.types.BeaconState, postState)));
  }

  // Return post-state
  return postState;
}
