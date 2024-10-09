import {SignedBeaconBlock, SignedBlindedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {BeaconStateTransitionMetrics, onPostStateMetrics, onStateCloneMetrics} from "./metrics.js";
import {beforeProcessEpoch, EpochTransitionCache, EpochTransitionCacheOpts} from "./cache/epochTransitionCache.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStateCapella,
  CachedBeaconStateDeneb,
} from "./types.js";
import {computeEpochAtSlot} from "./util/index.js";
import {verifyProposerSignature} from "./signatureSets/index.js";
import {
  processSlot,
  upgradeStateToAltair,
  upgradeStateToBellatrix,
  upgradeStateToCapella,
  upgradeStateToDeneb,
  upgradeStateToElectra,
} from "./slot/index.js";
import {processBlock} from "./block/index.js";
import {EpochTransitionStep, processEpoch} from "./epoch/index.js";
import {BlockExternalData, DataAvailableStatus, ExecutionPayloadStatus} from "./block/externalData.js";
import {ProcessBlockOpts} from "./block/types.js";

// Multifork capable state transition

// NOTE DENEB: Mandatory BlockExternalData to decide if block is available or not
export type StateTransitionOpts = BlockExternalData &
  EpochTransitionCacheOpts &
  ProcessBlockOpts & {
    verifyStateRoot?: boolean;
    verifyProposer?: boolean;
    verifySignatures?: boolean;
    dontTransferCache?: boolean;
  };

/**
 * `state.clone()` invocation source tracked in metrics
 */
export enum StateCloneSource {
  stateTransition = "stateTransition",
  processSlots = "processSlots",
}

/**
 * `state.hashTreeRoot()` invocation source tracked in metrics
 */
export enum StateHashTreeRootSource {
  stateTransition = "state_transition",
  blockTransition = "block_transition",
  prepareNextSlot = "prepare_next_slot",
  prepareNextEpoch = "prepare_next_epoch",
  regenState = "regen_state",
  computeNewStateRoot = "compute_new_state_root",
}

/**
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function stateTransition(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock,
  options: StateTransitionOpts = {
    // Assume default to be valid and available
    executionPayloadStatus: ExecutionPayloadStatus.valid,
    dataAvailableStatus: DataAvailableStatus.available,
  },
  metrics?: BeaconStateTransitionMetrics | null
): CachedBeaconStateAllForks {
  const {verifyStateRoot = true, verifyProposer = true} = options;

  const block = signedBlock.message;
  const blockSlot = block.slot;

  // .clone() before mutating state in state transition
  let postState = state.clone(options.dontTransferCache);

  if (metrics) {
    onStateCloneMetrics(postState, metrics, StateCloneSource.stateTransition);
  }

  // State is already a ViewDU, which won't commit changes. Equivalent to .setStateCachesAsTransient()
  // postState.setStateCachesAsTransient();

  // Process slots (including those with no blocks) since block.
  // Includes state upgrades
  postState = processSlotsWithTransientCache(postState, blockSlot, options, metrics);

  // Verify proposer signature only
  if (verifyProposer) {
    if (!verifyProposerSignature(postState, signedBlock)) {
      throw new Error("Invalid block signature");
    }
  }

  // Process block
  const fork = state.config.getForkSeq(block.slot);

  // Note: time only on success
  const processBlockTimer = metrics?.processBlockTime.startTimer();

  processBlock(fork, postState, block, options, options);

  const processBlockCommitTimer = metrics?.processBlockCommitTime.startTimer();
  postState.commit();
  processBlockCommitTimer?.();

  // Note: time only on success. Include processBlock and commit
  processBlockTimer?.();

  if (metrics) {
    onPostStateMetrics(postState, metrics);
  }

  // Verify state root
  if (verifyStateRoot) {
    const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer({
      source: StateHashTreeRootSource.stateTransition,
    });
    const stateRoot = postState.hashTreeRoot();
    hashTreeRootTimer?.();

    if (!ssz.Root.equals(block.stateRoot, stateRoot)) {
      throw new Error(
        `Invalid state root at slot ${block.slot}, expected=${toRootHex(block.stateRoot)}, actual=${toRootHex(
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
  epochTransitionCacheOpts?: EpochTransitionCacheOpts & {dontTransferCache?: boolean},
  metrics?: BeaconStateTransitionMetrics | null
): CachedBeaconStateAllForks {
  // .clone() before mutating state in state transition
  let postState = state.clone(epochTransitionCacheOpts?.dontTransferCache);

  if (metrics) {
    onStateCloneMetrics(postState, metrics, StateCloneSource.processSlots);
  }

  // State is already a ViewDU, which won't commit changes. Equivalent to .setStateCachesAsTransient()
  // postState.setStateCachesAsTransient();

  postState = processSlotsWithTransientCache(postState, slot, epochTransitionCacheOpts, metrics);

  // Apply changes to state, must do before hashing
  postState.commit();

  return postState;
}

/**
 * All processSlot() logic but separate so stateTransition() can recycle the caches
 *
 * Epoch transition will be processed at the last slot of an epoch. Note that compute_shuffling() is going
 * to be executed in parallel (either by napi-rs or worker thread) with processEpoch() like below:
 *
 *   state-transition
 *   ╔══════════════════════════════════════════════════════════════════════════════════╗
 *   ║   beforeProcessEpoch          processEpoch                 afterPRocessEpoch     ║
 *   ║  |-------------------------|--------------------|-------------------------------|║
 *   ║                       |                         |     |                          ║
 *   ╚═══════════════════════|═══════════════════════════════|══════════════════════════╝
 *                           |                               |
 *                         build()                          get()
 *                           |                               |
 *   ╔═══════════════════════V═══════════════════════════════V═══════════════════════════╗
 *   ║                       |                               |                           ║
 *   ║                       |-------------------------------|                           ║
 *   ║                          compute_shuffling()                                      ║
 *   ╚═══════════════════════════════════════════════════════════════════════════════════╝
 *   beacon-node ShufflingCache
 */
function processSlotsWithTransientCache(
  postState: CachedBeaconStateAllForks,
  slot: Slot,
  epochTransitionCacheOpts?: EpochTransitionCacheOpts,
  metrics?: BeaconStateTransitionMetrics | null
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

      const epochTransitionTimer = metrics?.epochTransitionTime.startTimer();

      let epochTransitionCache: EpochTransitionCache;
      {
        const timer = metrics?.epochTransitionStepTime.startTimer({step: EpochTransitionStep.beforeProcessEpoch});
        epochTransitionCache = beforeProcessEpoch(postState, epochTransitionCacheOpts);
        timer?.();
      }

      processEpoch(fork, postState, epochTransitionCache, metrics);

      const {currentEpoch, inclusionDelays, flags, isActiveCurrEpoch, isActivePrevEpoch, balances} =
        epochTransitionCache;
      metrics?.registerValidatorStatuses(
        currentEpoch,
        inclusionDelays,
        flags,
        isActiveCurrEpoch,
        isActivePrevEpoch,
        balances
      );

      postState.slot++;

      {
        const timer = metrics?.epochTransitionStepTime.startTimer({step: EpochTransitionStep.afterProcessEpoch});
        postState.epochCtx.afterProcessEpoch(postState, epochTransitionCache);
        timer?.();
      }

      // Running commit here is not strictly necessary. The cost of running commit twice (here + after process block)
      // Should be negligible but gives better metrics to differentiate the cost of it for block and epoch proc.
      {
        const timer = metrics?.epochTransitionCommitTime.startTimer();
        postState.commit();
        timer?.();
      }

      // Note: time only on success. Include beforeProcessEpoch, processEpoch, afterProcessEpoch, commit
      epochTransitionTimer?.();

      // Upgrade state if exactly at epoch boundary
      const stateEpoch = computeEpochAtSlot(postState.slot);
      if (stateEpoch === config.ALTAIR_FORK_EPOCH) {
        postState = upgradeStateToAltair(postState as CachedBeaconStatePhase0) as CachedBeaconStateAllForks;
      }
      if (stateEpoch === config.BELLATRIX_FORK_EPOCH) {
        postState = upgradeStateToBellatrix(postState as CachedBeaconStateAltair) as CachedBeaconStateAllForks;
      }
      if (stateEpoch === config.CAPELLA_FORK_EPOCH) {
        postState = upgradeStateToCapella(postState as CachedBeaconStateBellatrix) as CachedBeaconStateAllForks;
      }
      if (stateEpoch === config.DENEB_FORK_EPOCH) {
        postState = upgradeStateToDeneb(postState as CachedBeaconStateCapella) as CachedBeaconStateAllForks;
      }
      if (stateEpoch === config.ELECTRA_FORK_EPOCH) {
        postState = upgradeStateToElectra(postState as CachedBeaconStateDeneb) as CachedBeaconStateAllForks;
      }
    } else {
      postState.slot++;
    }
  }

  return postState;
}
