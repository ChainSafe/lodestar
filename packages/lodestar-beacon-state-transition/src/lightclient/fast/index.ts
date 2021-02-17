import {Lightclient} from "@chainsafe/lodestar-types";
import {IStateContext, phase0} from "../..";
import {processBlock} from "../block";

export function stateTransition(
  {state, epochCtx}: IStateContext<Lightclient.BeaconState>,
  signedBlock: Lightclient.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): IStateContext {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const types = epochCtx.config.types;

  const block = signedBlock.message;
  const postState = types.lightclient.BeaconState.clone(state);
  // process slots (including those with no blocks) since block
  phase0.fast.processSlots(epochCtx, postState, block.slot);

  // verify signature
  if (verifyProposer) {
    if (!phase0.fast.verifyBlockSignature(epochCtx, postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }
  // process block
  processBlock(epochCtx.config, postState, block, verifySignatures);
  // verify state root
  if (verifyStateRoot) {
    if (!types.Root.equals(block.stateRoot, types.BeaconState.hashTreeRoot(postState))) {
      throw new Error("Invalid state root");
    }
  }
  epochCtx.loadState(postState);
  return toIStateContext(epochCtx, postState);
}
