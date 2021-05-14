/* eslint-disable import/namespace */
import {ForkName} from "@chainsafe/lodestar-config";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import * as phase0 from "../phase0";
import * as altair from "../altair";
import {IBeaconStateTransitionMetrics} from "../metrics";
import {verifyProposerSignature} from "./signatureSets";
import {CachedBeaconState} from "./util";

type StateTransitionFunctions = {
  processSlots(
    state: CachedBeaconState<allForks.BeaconState>,
    slot: Slot,
    metrics?: IBeaconStateTransitionMetrics | null
  ): CachedBeaconState<allForks.BeaconState>;
  upgradeState(state: CachedBeaconState<allForks.BeaconState>): CachedBeaconState<allForks.BeaconState>;
};

/**
 * Record of fork to state transition functions
 */
const implementations: Record<ForkName, StateTransitionFunctions> = {
  [ForkName.phase0]: (phase0 as unknown) as StateTransitionFunctions,
  [ForkName.altair]: (altair as unknown) as StateTransitionFunctions,
};

// Multifork capable state transition

/**
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function stateTransition(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean},
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconState<allForks.BeaconState> {
  const {verifyStateRoot = true, verifyProposer = true} = options || {};
  const {config} = state;

  const block = signedBlock.message;
  const blockSlot = block.slot;

  let postState = state.clone();

  postState.setStateCachesAsTransient();

  // process slots (including those with no blocks) since block
  // includes state upgrades
  postState = _processSlots(postState, blockSlot, metrics);

  // verify signature
  if (verifyProposer) {
    if (!verifyProposerSignature(postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }

  // process block

  processBlock(postState, block, options, metrics);

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
 * Multifork capable processBlock()
 *
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function processBlock(
  postState: CachedBeaconState<allForks.BeaconState>,
  block: allForks.BeaconBlock,
  options?: {verifySignatures?: boolean},
  metrics?: IBeaconStateTransitionMetrics | null
): void {
  const {verifySignatures = true} = options || {};
  const blockFork = postState.config.getForkName(block.slot);

  switch (blockFork) {
    case ForkName.phase0:
      phase0.processBlock(
        postState as CachedBeaconState<phase0.BeaconState>,
        block as phase0.BeaconBlock,
        verifySignatures,
        metrics
      );
      break;
    case ForkName.altair:
      altair.processBlock(
        postState as CachedBeaconState<altair.BeaconState>,
        block as altair.BeaconBlock,
        verifySignatures
      );
      break;
    default:
      throw new Error(`Block processing not implemented for fork ${blockFork}`);
  }
}

/**
 * Like `processSlots` from the spec but additionally handles fork upgrades
 *
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function processSlots(
  state: CachedBeaconState<allForks.BeaconState>,
  slot: Slot,
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconState<allForks.BeaconState> {
  let postState = state.clone();

  postState.setStateCachesAsTransient();

  postState = _processSlots(postState, slot, metrics);

  postState.setStateCachesAsPersistent();

  return postState;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function _processSlots(
  state: CachedBeaconState<allForks.BeaconState>,
  slot: Slot,
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconState<allForks.BeaconState> {
  let postState = state;
  const {config} = state;
  const preSlot = state.slot;

  // forks sorted in order
  const forkInfos = Object.values(config.forks);
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
    const nextForkStartSlot = config.params.SLOTS_PER_EPOCH * nextForkInfo.epoch;

    // if the starting state slot is after the current fork, skip to the next fork
    if (preSlot > nextForkStartSlot) {
      continue;
    }
    // if the requested slot is not after the next fork, process slots and exit
    if (slot < nextForkStartSlot) {
      impl.processSlots(postState, slot, metrics);
      break;
    }
    const nextImpl = implementations[nextForkInfo.name];
    if (!nextImpl) {
      throw new Error(`Slot processing not implemented for fork ${nextForkInfo.name}`);
    }
    // else (the requested slot is equal or after the next fork), process up to the fork
    impl.processSlots(postState, nextForkStartSlot);

    postState = nextImpl.upgradeState(postState);
  }
  return postState;
}
