import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {getBlockSignatureSet, IStateContext} from "./util";
import {StateTransitionEpochContext} from "./util/epochContext";
import {EpochContext} from "./util/epochContext";
import {processSlots} from "./slot";
import {processBlock} from "./block";
import {
  getAllBlockSignatureSets,
  getAllBlockSignatureSetsExceptProposer,
  ISignatureSet,
  verifySignatureSetsBatch,
} from "./signatureSets";

export {IStateContext, EpochContext};

/**
 * Implementation of protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  {state, epochCtx: eiEpochCtx}: IStateContext,
  signedBlock: SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): IStateContext {
  const epochCtx = new StateTransitionEpochContext(undefined, eiEpochCtx);
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const types = epochCtx.config.types;

  const block = signedBlock.message;
  const postState = types.BeaconState.clone(state);
  // process slots (including those with no blocks) since block
  processSlots(epochCtx, postState, block.slot);

  let signatureSets: ISignatureSet[] = [];
  if (verifySignatures && verifyProposer) {
    signatureSets = getAllBlockSignatureSets(epochCtx, state, signedBlock);
  } else if (verifySignatures) {
    signatureSets = getAllBlockSignatureSetsExceptProposer(epochCtx, state, signedBlock);
  } else if (verifyProposer) {
    signatureSets = [getBlockSignatureSet(epochCtx, state, signedBlock)];
  }

  if (signatureSets.length > 0 && !verifySignatureSetsBatch(signatureSets)) {
    throw new Error("Invalid block signature");
  }

  // process block, signatures were verified above already
  processBlock(epochCtx, postState, block, false);
  // verify state root
  if (verifyStateRoot) {
    if (!types.Root.equals(block.stateRoot, types.BeaconState.hashTreeRoot(postState))) {
      throw new Error("Invalid state root");
    }
  }
  return toIStateContext(epochCtx, postState);
}

/**
 * Trim epochProcess in epochCtx, and insert the standard/exchange interface epochProcess to the final IStateContext
 */
export function toIStateContext(epochCtx: StateTransitionEpochContext, state: BeaconState): IStateContext {
  const epochProcess = epochCtx.epochProcess;
  epochCtx.epochProcess = undefined;
  return {
    state: state,
    epochCtx: new EpochContext(undefined, epochCtx),
    epochProcess,
  };
}
