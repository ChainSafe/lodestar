/* eslint-disable import/namespace */
import {ForkName} from "@chainsafe/lodestar-config";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import * as phase0 from "../phase0";
import * as altair from "../altair";
import {verifyProposerSignature} from "./signatureSets";
import {CachedBeaconState} from "./util";

type StateTransitionFunctions = {
  processSlots(state: CachedBeaconState<allForks.BeaconState>, slot: Slot): CachedBeaconState<allForks.BeaconState>;
  upgradeState(state: CachedBeaconState<allForks.BeaconState>): CachedBeaconState<allForks.BeaconState>;
};

/**
 * Record of fork to state transition functions
 */
const implementations: Record<ForkName, StateTransitionFunctions> = {
  [ForkName.phase0]: (phase0.fast as unknown) as StateTransitionFunctions,
  [ForkName.altair]: (altair.fast as unknown) as StateTransitionFunctions,
};

// Multifork capable state transition

/**
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean}
): CachedBeaconState<allForks.BeaconState> {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const {config} = state;

  const block = signedBlock.message;
  const blockSlot = block.slot;
  const blockFork = config.getForkName(blockSlot);
  let postState = state.clone();

  postState.setStateCachesAsTransient();

  // process slots (including those with no blocks) since block
  // includes state upgrades
  postState = _processSlots(postState, blockSlot);

  // verify signature
  if (verifyProposer) {
    if (!verifyProposerSignature(postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }

  // process block
  switch (blockFork) {
    case ForkName.phase0:
      phase0.fast.processBlock(
        postState as CachedBeaconState<phase0.BeaconState>,
        block as phase0.BeaconBlock,
        verifySignatures
      );
      break;
    case ForkName.altair:
      altair.fast.processBlock(
        postState as CachedBeaconState<altair.BeaconState>,
        block as altair.BeaconBlock,
        verifySignatures
      );
      break;
    default:
      throw new Error(`Block processing not implemented for fork ${blockFork}`);
  }

  // verify state root
  if (verifyStateRoot) {
    if (!config.types.Root.equals(block.stateRoot, postState.tree.root)) {
      throw new Error("Invalid state root");
    }
  }

  postState.setStateCachesAsPersistent();

  return postState;
}

/**
 * Like `processSlots` from the spec but additionally handles fork upgrades
 *
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function processSlots(
  state: CachedBeaconState<allForks.BeaconState>,
  slot: Slot
): CachedBeaconState<allForks.BeaconState> {
  let postState = state.clone();

  postState.setStateCachesAsTransient();

  postState = _processSlots(postState, slot);

  postState.setStateCachesAsPersistent();

  return postState;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function _processSlots(
  state: CachedBeaconState<allForks.BeaconState>,
  slot: Slot
): CachedBeaconState<allForks.BeaconState> {
  let postState = state;
  const {config} = state;
  const preSlot = state.slot;

  // forks sorted in order
  const forkInfos = Object.values(config.getForkInfoRecord());
  // for each fork
  for (let i = 0; i < forkInfos.length; i++) {
    const currentForkInfo = forkInfos[i];
    const nextForkInfo = forkInfos[i + 1];

    const impl = implementations[currentForkInfo.name];
    if (!impl) {
      throw new Error(`Slot processing not implemented for fork ${currentForkInfo.name}`);
    }
    // if there's no next fork, process slots without worrying about fork upgrades and exit
    if (!nextForkInfo) {
      impl.processSlots(postState, slot);
      break;
    }
    // if the starting state slot is after the current fork, skip to the next fork
    if (preSlot > nextForkInfo.slot) {
      continue;
    }
    // if the requested slot is not after the next fork, process slots and exit
    if (slot < nextForkInfo.slot) {
      impl.processSlots(postState, slot);
      break;
    }
    const nextImpl = implementations[currentForkInfo.name];
    if (!nextImpl) {
      throw new Error(`Slot processing not implemented for fork ${nextForkInfo.name}`);
    }
    // else (the requested slot is equal or after the next fork), process up to the fork
    impl.processSlots(postState, nextForkInfo.slot);

    postState = nextImpl.upgradeState(postState);
  }
  return postState;
}
