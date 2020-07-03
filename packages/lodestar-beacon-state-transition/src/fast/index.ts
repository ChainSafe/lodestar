import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {verifyBlockSignature} from "../util";
import {EpochContext, IStateContext} from "./util";
import {processSlots} from "./slot";
import {processBlock} from "./block";


export {
  IStateContext,
  EpochContext,
};

export function fastStateTransition(
  {state, epochCtx}: IStateContext,
  signedBlock: SignedBeaconBlock,
  verifyStateRoot = true,
  verifyProposer = true,
  verifySignatures = true,
): IStateContext {
  const types = epochCtx.config.types;
  const block = signedBlock.message;
  const postState = types.BeaconState.clone(state);
  // process slots (including those with no blocks) since block
  processSlots(epochCtx, postState, block.slot);
  // verify signature
  if (verifyProposer) {
    if (!verifyBlockSignature(epochCtx.config, postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }
  // process block
  processBlock(epochCtx, postState, block, verifySignatures);
  // verify state root
  if (verifyStateRoot) {
    if (!types.Root.equals(
      block.stateRoot,
      types.BeaconState.hashTreeRoot(postState)
    )) {
      throw new Error("Invalid state root");
    }
  }
  return {
    state: postState,
    epochCtx: epochCtx
  };
}
