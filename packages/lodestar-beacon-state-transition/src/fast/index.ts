import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {verifyBlockSignature} from "./util/block";
import {processSlots} from "./slot";
import {processBlock} from "./block";
import {CachedBeaconState} from "./util/cachedBeaconState";

/**
 * Implementation of protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): CachedBeaconState {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const types = cachedState.config.types;

  const block = signedBlock.message;
  const postState = cachedState.clone();
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
    if (!types.Root.equals(block.stateRoot, postState.hashTreeRoot())) {
      throw new Error("Invalid state root");
    }
  }
  return postState;
}
