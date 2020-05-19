import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {verifyBlockSignature} from "../util";
import {EpochContext} from "./util";
import {processSlots} from "./slot";
import {processBlock} from "./block";


export {
  EpochContext,
};

export function fastStateTransition(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock,
  verifyStateRoot = true,
  verifyProposer = true,
  verifySignatures = true,
): BeaconState {
  const types = epochCtx.config.types;
  const postState = types.BeaconState.clone(state);
  const block = signedBlock.message;
  // process slots (including those with no blocks) since block
  processSlots(epochCtx, postState, block.slot);
  // verify signature
  if (verifyProposer) {
    if (!verifyBlockSignature(epochCtx.config, postState, signedBlock)) {
      throw new Error();
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
      throw new Error();
    }
  }
  return postState;
}
