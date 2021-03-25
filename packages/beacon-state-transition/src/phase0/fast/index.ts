import {phase0} from "@chainsafe/lodestar-types";
import {processBlock} from "./block";
import {processSlots} from "./slot";
import {CachedBeaconState, verifyBlockSignature} from "./util";

export * from "./block";
export * from "./epoch";
export * from "./signatureSets";
export * from "./slot";
export * from "./util";

/**
 * Implementation of protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): CachedBeaconState<phase0.BeaconState> {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const types = state.config.types;

  const block = signedBlock.message;
  const postState = state.clone();
  // process slots (including those with no blocks) since block
  processSlots(postState, block.slot);

  // verify signature
  if (verifyProposer) {
    if (!verifyBlockSignature(postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }
  // process block
  processBlock(postState, block, verifySignatures);
  // verify state root
  if (verifyStateRoot) {
    if (!types.Root.equals(block.stateRoot, postState.tree.root)) {
      throw new Error("Invalid state root");
    }
  }
  return postState;
}
