/**
 * @module chain/stateTransition
 */

import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {verifyBlockSignature} from "./util/block";
import {processBlock} from "./block";
import {processSlots} from "./slot";

export * from "./constants";
export * from "./util";
export * from "./epoch";
export * from "./block";
export * from "./slot";

export * from "./fast";

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
  signedBlock: SignedBeaconBlock,
  validateStateRoot = false,
  verifyProposer = true,
  verifySignatures = true
): BeaconState {
  // Clone state because process slots and block are not pure
  const postState = config.types.BeaconState.clone(state);
  // Process slots (including those with no blocks) since block
  processSlots(config, postState, signedBlock.message.slot);
  // Verify block signature
  if (verifyProposer) {
    verifyBlockSignature(config, state, signedBlock);
  }
  // Process block
  processBlock(config, postState, signedBlock.message, verifySignatures);
  // Validate state root (`validate_state_root == True` in production)
  if (validateStateRoot){
    assert(config.types.Root.equals(
      signedBlock.message.stateRoot,
      config.types.BeaconState.hashTreeRoot(postState)
    ));
  }

  // Return post-state
  return postState;
}
