import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {verifyBlockSignature} from "./util";
import {IStateContext} from "./util";
import {EpochContext} from "./util/epochContext";
import {processSlots} from "./slot";
import {processBlock} from "./block";

export {IStateContext, EpochContext};

/**
 * Implementation of protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  {state, epochCtx}: IStateContext,
  signedBlock: SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): IStateContext {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const types = epochCtx.config.types;

  const block = signedBlock.message;
  const postState = state.clone();
  // process slots (including those with no blocks) since block
  processSlots(epochCtx, postState, block.slot);

  // verify signature
  if (verifyProposer) {
    if (!verifyBlockSignature(epochCtx, postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }
  // process block
  processBlock(epochCtx, postState, block, verifySignatures);
  // verify state root
  if (verifyStateRoot) {
    if (!types.Root.equals(block.stateRoot, types.BeaconState.hashTreeRoot(postState))) {
      throw new Error("Invalid state root");
    }
  }
  return {
    state: postState,
    epochCtx,
  };
}
