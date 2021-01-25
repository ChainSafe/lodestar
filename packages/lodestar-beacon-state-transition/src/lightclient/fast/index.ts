import {Lightclient} from "@chainsafe/lodestar-types";
import {IStateContext, toIStateContext} from "../..";
import {StateTransitionEpochContext} from "../../fast/util/epochContext";
import {processSlots} from "../../fast/slot";
import {verifyBlockSignature} from "../../fast/util";
import {processBlock} from "../block";

export function stateTransition(
  {state, epochCtx: eiEpochCtx}: IStateContext<Lightclient.BeaconState>,
  signedBlock: Lightclient.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): IStateContext {
  const epochCtx = new StateTransitionEpochContext(undefined, eiEpochCtx);
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const types = epochCtx.config.types;

  const block = signedBlock.message;
  const postState = types.lightclient.BeaconState.clone(state);
  // process slots (including those with no blocks) since block
  processSlots(epochCtx, postState, block.slot);

  // verify signature
  if (verifyProposer) {
    if (!verifyBlockSignature(epochCtx, postState, signedBlock)) {
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
