import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {processSlots} from "./slot";
import {verifyBlockSignature} from "../..";
import {processBlock} from "./block";
import {assert} from "@chainsafe/lodestar-utils";

export * from "./block";
export * from "./epoch";
export * from "./slot";

/**
 * The ETH2.0 Beacon Chain state transition function
 * @param config Beacon Chain configuration
 * @param state Current state
 * @param block Block being processed
 * @param options.verifyStateRoot Compare state root at the end of state execution
 * @param options.verifyProposer Skip block proposer signature verification
 * @param options.verifySignatures Skip operations signature verification
 */
export function stateTransition(
  config: IBeaconConfig,
  state: BeaconState,
  signedBlock: SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): BeaconState {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};

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
  if (verifyStateRoot) {
    assert.true(
      config.types.Root.equals(signedBlock.message.stateRoot, config.types.BeaconState.hashTreeRoot(postState)),
      "State root is not valid"
    );
  }

  // Return post-state
  return postState;
}
