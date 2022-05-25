/* eslint-disable import/namespace */
import {allForks, Slot, ssz} from "@chainsafe/lodestar-types";
import {ForkName, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";
import * as phase0 from "../phase0/index.js";
import * as altair from "../altair/index.js";
import * as bellatrix from "../bellatrix/index.js";
import {IBeaconStateTransitionMetrics} from "../metrics.js";
import {EpochProcess, beforeProcessEpoch} from "../cache/epochProcess.js";
import {verifyProposerSignature} from "./signatureSets/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStatePhase0, CachedBeaconStateAltair} from "../types.js";
import {processSlot} from "./slot/index.js";
import {computeEpochAtSlot} from "../util/index.js";

type StateAllForks = CachedBeaconStateAllForks;
type StatePhase0 = CachedBeaconStatePhase0;
type StateAltair = CachedBeaconStateAltair;

type ProcessBlockFn = (state: StateAllForks, block: allForks.BeaconBlock, verifySignatures: boolean) => void;
type ProcessEpochFn = (state: StateAllForks, epochProcess: EpochProcess) => void;
type UpgradeStateFn = (state: StateAllForks) => StateAllForks;

const processBlockByFork: Record<ForkName, ProcessBlockFn> = {
  [ForkName.phase0]: phase0.processBlock as ProcessBlockFn,
  [ForkName.altair]: altair.processBlock as ProcessBlockFn,
  [ForkName.bellatrix]: bellatrix.processBlock as ProcessBlockFn,
};

const processEpochByFork: Record<ForkName, ProcessEpochFn> = {
  [ForkName.phase0]: phase0.processEpoch as ProcessEpochFn,
  [ForkName.altair]: altair.processEpoch as ProcessEpochFn,
  [ForkName.bellatrix]: altair.processEpoch as ProcessEpochFn,
};

export const upgradeStateByFork: Record<Exclude<ForkName, ForkName.phase0>, UpgradeStateFn> = {
  [ForkName.altair]: altair.upgradeState as UpgradeStateFn,
  [ForkName.bellatrix]: bellatrix.upgradeState as UpgradeStateFn,
};
// Multifork capable state transition

/**
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function stateTransition(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock,
  options?: {verifyStateRoot?: boolean; verifyProposer?: boolean; verifySignatures?: boolean},
  metrics?: IBeaconStateTransitionMetrics | null
): CachedBeaconStateAllForks {
  const {verifyStateRoot = true, verifyProposer = true} = options || {};

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
  processBlock(postState, block, options, metrics);

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
 * Multifork capable processBlock()
 *
 * Implementation Note: follows the optimizations in protolambda's eth2fastspec (https://github.com/protolambda/eth2fastspec)
 */
export function processBlock(
  postState: CachedBeaconStateAllForks,
  block: allForks.BeaconBlock,
  options?: {verifySignatures?: boolean},
  metrics?: IBeaconStateTransitionMetrics | null
): void {
  const {verifySignatures = true} = options || {};
  const fork = postState.config.getForkName(block.slot);

  const timer = metrics?.stfnProcessBlock.startTimer();
  try {
    processBlockByFork[fork](postState, block, verifySignatures);
  } finally {
    if (timer) timer();
  }
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
  postState: StateAllForks,
  slot: Slot,
  metrics?: IBeaconStateTransitionMetrics | null
): StateAllForks {
  const {config} = postState;
  if (postState.slot > slot) {
    throw Error(`Too old slot ${slot}, current=${postState.slot}`);
  }

  while (postState.slot < slot) {
    processSlot(postState);

    // Process epoch on the first slot of the next epoch
    if ((postState.slot + 1) % SLOTS_PER_EPOCH === 0) {
      // At fork boundary we don't want to process "next fork" epoch before upgrading state
      const fork = postState.config.getForkName(postState.slot);
      const timer = metrics?.stfnEpochTransition.startTimer();
      try {
        const epochProcess = beforeProcessEpoch(postState);
        processEpochByFork[fork](postState, epochProcess);
        const {currentEpoch, statuses, balances} = epochProcess;
        metrics?.registerValidatorStatuses(currentEpoch, statuses, balances);

        postState.slot++;
        postState.epochCtx.afterProcessEpoch(postState, epochProcess);
      } finally {
        if (timer) timer();
      }

      // Upgrade state if exactly at epoch boundary
      const stateSlot = computeEpochAtSlot(postState.slot);
      if (stateSlot === config.ALTAIR_FORK_EPOCH) {
        postState = altair.upgradeState(postState as StatePhase0) as StateAllForks;
      }
      if (stateSlot === config.BELLATRIX_FORK_EPOCH) {
        postState = bellatrix.upgradeState(postState as StateAltair) as StateAllForks;
      }
    } else {
      postState.slot++;
    }
  }

  return postState;
}
