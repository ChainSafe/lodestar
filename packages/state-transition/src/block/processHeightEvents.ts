import {PENDING_FINALITY_WINDOW, TIMEOUT_DELAY_SLOTS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ZERO_HASH} from "../constants/index.js";
import {zeroHeightParticipation} from "../slot/upgradeStateToEip8453.js";
import {CachedBeaconStateEip8453} from "../types.js";
import {getQuorumContext, hasQuorum, readHeightCheckpoint} from "../util/eip8453.js";

/**
 * Spec: process_height_events
 *
 * Finalizes the highest pending justification with a quorum, then justifies the target of the current height and
 * moves to the next height on a target quorum, or moves to the next height on a progress quorum once
 * TIMEOUT_DELAY_SLOTS have passed since the target.
 */
export function processHeightEvents(state: CachedBeaconStateEip8453): void {
  const quorumCtx = getQuorumContext(state);

  // Finalize the highest pending justification with a quorum
  const pendingFinality = state.pendingFinality;
  const pendingCount = pendingFinality.length;
  let finalizedCount = 0;
  for (let i = 0; i < pendingCount; i++) {
    const pending = pendingFinality.getReadonly(i);
    if (hasQuorum(state, pending.participation.getAll(), quorumCtx)) {
      state.finalizedCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU(readHeightCheckpoint(pending.checkpoint));
      state.finalizedSlot = pending.slot;
      // pending justifications are in increasing height order, every earlier one is now below finality
      finalizedCount = i + 1;
    }
  }
  if (finalizedCount > 0) {
    state.pendingFinality = pendingFinality.sliceFrom(finalizedCount);
  }

  if (hasQuorum(state, state.targetParticipation.getAll(), quorumCtx)) {
    const target = readHeightCheckpoint(state.targetCheckpoint);
    state.justifiedCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU(target);
    // Keep only the newest pending justifications
    if (state.pendingFinality.length === PENDING_FINALITY_WINDOW) {
      state.pendingFinality = state.pendingFinality.sliceFrom(1);
    }
    const pending = ssz.eip8453.PendingFinality.defaultViewDU();
    pending.checkpoint = ssz.eip8453.HeightCheckpoint.toViewDU(target);
    pending.slot = state.targetSlot;
    pending.participation = zeroHeightParticipation(state.validators.length);
    state.pendingFinality.push(pending);
    advanceHeight(state);
  } else if (
    hasQuorum(state, state.progressParticipation.getAll(), quorumCtx) &&
    // Timeouts count only after the delay
    state.slot >= state.targetSlot + TIMEOUT_DELAY_SLOTS
  ) {
    advanceHeight(state);
  }
}

/**
 * Spec: advance_height
 * The target root is left empty and filled in by the next `process_slot`, see `processSlot`.
 */
export function advanceHeight(state: CachedBeaconStateEip8453): void {
  const validatorCount = state.validators.length;
  state.targetCheckpoint = ssz.eip8453.HeightCheckpoint.toViewDU({
    height: state.targetCheckpoint.height + 1,
    root: ZERO_HASH,
  });
  state.targetSlot = state.latestBlockHeader.slot;
  state.targetParticipation = zeroHeightParticipation(validatorCount);
  state.progressParticipation = zeroHeightParticipation(validatorCount);
}
