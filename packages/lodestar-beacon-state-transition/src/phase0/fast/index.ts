import {phase0} from "@chainsafe/lodestar-types";
import {processBlock} from "./block";
import {processSlots} from "./slot";
import {IStateContext, verifyBlockSignature} from "./util";

export * from "./block";
export * from "./epoch";
export * from "./slot";
export * from "./util";
export * from "./signatureSets";

/**
 * Implementation of protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  {state, epochCtx}: IStateContext,
  signedBlock: phase0.SignedBeaconBlock,
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
    if (!types.Root.equals(block.stateRoot, types.phase0.BeaconState.hashTreeRoot(postState.getOriginalState()))) {
      throw new Error("Invalid state root");
    }
  }
  return {
    state: postState,
    epochCtx,
  };
}
