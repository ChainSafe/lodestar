/* eslint-disable import/namespace */
import {allForks, Slot, ssz} from "@chainsafe/lodestar-types";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconStateTransitionMetrics} from "./metrics.js";
import {beforeProcessEpoch} from "./cache/epochProcess.js";
import {CachedBeaconStateAllForks, CachedBeaconStatePhase0, CachedBeaconStateAltair} from "./types.js";
import {computeEpochAtSlot} from "./util/index.js";
import {verifyProposerSignature} from "./signatureSets/index.js";
import {processSlot, upgradeStateToAltair, upgradeStateToBellatrix} from "./slot/index.js";
import {processBlock} from "./block/index.js";
import {processEpoch} from "./epoch/index.js";

// Multifork capable state transition

/**
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function stateTransition(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.FullOrBlindedSignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean},
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconStateAllForks {
  const {verifyStateRoot = true, verifyProposer = true, verifySignatures = true} = options || {};

  const block = signedBlock.message;
  const blockSlot = block.slot;

  let postState = state.clone();

  // State is already a ViewDU, which won't commit changes. Equivalent to .setStateCachesAsTransient()
  // postState.setStateCachesAsTransient();

  // Process slots (including those with no blocks) since block.
  // Includes state upgrades
  postState = processSlotsWithTransientCache(postState, blockSlot, metrics);

  // Verify proposer signature only
  if (verifyProposer) {
    if (!verifyProposerSignature(postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }

  // Process block
  const fork = state.config.getForkSeq(block.slot);

  const timer = metrics?.stfnProcessBlock.startTimer();
  try {
    processBlock(fork, postState, block, verifySignatures, null);
  } finally {
    timer?.();
  }

  // Apply changes to state, must do before hashing. Note: .hashTreeRoot() automatically commits() too
  postState.commit();

  // Verify state root
  if (verifyStateRoot) {
    const stateRoot = postState.hashTreeRoot();
    if (!ssz.Root.equals(block.stateRoot, stateRoot)) {
      throw new Error(
        `Invalid state root at slot ${block.slot}, expected=${toHexString(block.stateRoot)}, actual=${toHexString(
          stateRoot
        )}`
      );
    }
  }

  return postState;
}

/**
 * Like `processSlots` from the spec but additionally handles fork upgrades
 *
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function processSlots(
  state: CachedBeaconStateAllForks,
  slot: Slot,
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconStateAllForks {
  let postState = state.clone();

  // State is already a ViewDU, which won't commit changes. Equivalent to .setStateCachesAsTransient()
  // postState.setStateCachesAsTransient();

  postState = processSlotsWithTransientCache(postState, slot, metrics);

  // Apply changes to state, must do before hashing
  postState.commit();

  return postState;
}

/**
 * All processSlot() logic but separate so stateTransition() can recycle the caches
 */
function processSlotsWithTransientCache(
  postState: CachedBeaconStateAllForks,
  slot: Slot,
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconStateAllForks {
  const {config} = postState;
  if (postState.slot > slot) {
    throw Error(`Too old slot ${slot}, current=${postState.slot}`);
  }

  while (postState.slot < slot) {
    processSlot(postState);

    // Process epoch on the first slot of the next epoch
    if ((postState.slot + 1) % SLOTS_PER_EPOCH === 0) {
      // At fork boundary we don't want to process "next fork" epoch before upgrading state
      const fork = postState.config.getForkSeq(postState.slot);
      const timer = metrics?.stfnEpochTransition.startTimer();
      try {
        const epochProcess = beforeProcessEpoch(postState);
        processEpoch(fork, postState, epochProcess);
        const {currentEpoch, statuses, balances} = epochProcess;
        metrics?.registerValidatorStatuses(currentEpoch, statuses, balances);

        postState.slot++;
        postState.epochCtx.afterProcessEpoch(postState, epochProcess);
      } finally {
        timer?.();
      }

      // Upgrade state if exactly at epoch boundary
      const stateSlot = computeEpochAtSlot(postState.slot);
      if (stateSlot === config.ALTAIR_FORK_EPOCH) {
        postState = upgradeStateToAltair(postState as CachedBeaconStatePhase0) as CachedBeaconStateAllForks;
      }
      if (stateSlot === config.BELLATRIX_FORK_EPOCH) {
        postState = upgradeStateToBellatrix(postState as CachedBeaconStateAltair) as CachedBeaconStateAllForks;
      }
    } else {
      postState.slot++;
    }
  }

  return postState;
}
