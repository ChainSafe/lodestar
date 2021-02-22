import {phase0, verifyBlockSignature} from "../..";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {processBlock} from "./block";
import {upgrade} from "./upgrade";

export * from "./sync_committee";
export * from "./block";
export * from "./upgrade";
export * from "./epoch";

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
  state: lightclient.BeaconState,
  signedBlock: lightclient.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): lightclient.BeaconState {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};

  // Clone state because process slots and block are not pure
  let postState = config.types.lightclient.BeaconState.clone(state);
  // Process slots (including those with no blocks) since block
  phase0.processSlots(config, postState, signedBlock.message.slot);
  if (postState.slot === config.params.LIGHTCLIENT_PATCH_FORK_SLOT) {
    postState = upgrade(config, postState);
  }
  // Verify block signature
  if (verifyProposer) {
    verifyBlockSignature(config, state, signedBlock);
  }
  // Process block
  processBlock(config, postState, signedBlock.message, verifySignatures);
  // Validate state root (`validate_state_root == True` in production)
  if (verifyStateRoot) {
    assert.true(
      config.types.Root.equals(
        signedBlock.message.stateRoot,
        config.types.lightclient.BeaconState.hashTreeRoot(postState)
      ),
      "State root is not valid"
    );
  }

  // Return post-state
  return postState;
}
