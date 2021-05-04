import {ForkName} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IBeaconStateTransitionMetrics} from "../metrics";
import {processBlock, processSlots} from "../phase0/fast";
import {verifyProposerSignature} from "./signatureSets";
import {CachedBeaconState} from "./util";

// Multifork capable state transition

/**
 * Implementation of protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function fastStateTransition(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean},
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconState<allForks.BeaconState> {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};
  const {config} = state;

  const preSlot = state.slot;
  const preFork = config.getForkName(preSlot);
  const block = signedBlock.message;
  const blockSlot = block.slot;
  const blockFork = config.getForkName(blockSlot);
  const postState = state.clone();

  setStateCachesAsTransient(postState);

  // process slots (including those with no blocks) since block
  switch (preFork) {
    case ForkName.phase0:
      processSlots(postState as CachedBeaconState<phase0.BeaconState>, block.slot, metrics);
      break;
    default:
      throw new Error(`Slot processing not implemented for fork ${preFork}`);
  }

  // perform state upgrades
  // TODO

  // verify signature
  if (verifyProposer) {
    if (!verifyProposerSignature(postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }

  // process block

  switch (blockFork) {
    case ForkName.phase0:
      processBlock(
        postState as CachedBeaconState<phase0.BeaconState>,
        block as phase0.BeaconBlock,
        verifySignatures,
        metrics
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

  setStateCachesAsPersistent(postState);

  return postState;
}

/**
 * Toggle all `MutableVector` caches to use `TransientVector`
 */
function setStateCachesAsTransient(state: CachedBeaconState<allForks.BeaconState>): void {
  state.validators.persistent.asTransient();
  state.balances.persistent.asTransient();
  state.previousEpochParticipation.persistent.asTransient();
  state.currentEpochParticipation.persistent.asTransient();
}

/**
 * Toggle all `MutableVector` caches to use `PersistentVector`
 */
function setStateCachesAsPersistent(state: CachedBeaconState<allForks.BeaconState>): void {
  state.validators.persistent.asPersistent();
  state.balances.persistent.asPersistent();
  state.previousEpochParticipation.persistent.asPersistent();
  state.currentEpochParticipation.persistent.asPersistent();
}
