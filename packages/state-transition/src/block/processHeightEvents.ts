import {
  FINALITY_FLAG_INDEX,
  PROGRESS_FLAG_INDEX,
  SLOTS_PER_ROUND,
  TARGET_FLAG_INDEX,
  TIMEOUT_DELAY_ROUNDS,
} from "@lodestar/params";
import {Root, ssz} from "@lodestar/types";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateDecoupled} from "../types.js";
import {FINALITY_FLAG, hasQuorum, isZeroRoot, readHeightPair} from "../util/decoupled.js";
import {zeroProgressiveListBasicRootNode} from "../util/ssz.js";

export type ProcessHeightEventsOpts = {
  /** Rounds to wait after entering a height before a progress quorum may advance it. 0 disables the guard. */
  timeoutDelayRounds?: number;
};

/**
 * Spec: advance_height (decoupled-consensus/beacon-chain.md)
 *
 * Deviation: the spec hashes `latest_block_header` here, but its `state_root` is still zero during
 * block processing. The root is written as zero and filled in by `fillHeightTargetRoot` during the
 * next `process_slot`. See DC-ISSUES.md "Deferred target root".
 */
export function advanceHeight(state: CachedBeaconStateDecoupled, resetFinalityParticipation: boolean): void {
  state.targetPair = ssz.decoupled.HeightPair.toViewDU({height: state.targetPair.height + 1, root: ZERO_HASH});
  state.targetSlot = state.latestBlockHeader.slot;

  const length = state.heightParticipation.length;
  if (resetFinalityParticipation) {
    state.heightParticipation = ssz.decoupled.BeaconState.fields.heightParticipation.getViewDU(
      zeroProgressiveListBasicRootNode(ssz.decoupled.BeaconState.fields.heightParticipation.itemsPerChunk, length)
    );
  } else {
    const flags = state.heightParticipation.getAll();
    for (let i = 0; i < flags.length; i++) {
      flags[i] &= FINALITY_FLAG;
    }
    state.heightParticipation = ssz.decoupled.BeaconState.fields.heightParticipation.toViewDU(flags);
  }
}

/**
 * Spec: process_height_events (decoupled-consensus/beacon-chain.md)
 *
 * Deviation: the progress event is delayed by `TIMEOUT_DELAY_ROUNDS` after the height was entered, as
 * Prysm does and as the paper's δ_t requires. See DC-ISSUES.md "Timeout delay on progress-based advancement".
 */
export function processHeightEvents(state: CachedBeaconStateDecoupled, opts: ProcessHeightEventsOpts = {}): void {
  const timeoutDelayRounds = opts.timeoutDelayRounds ?? TIMEOUT_DELAY_ROUNDS;

  if (state.justifiedPair.height > state.finalizedPair.height && hasQuorum(state, FINALITY_FLAG_INDEX)) {
    state.finalizedPair = ssz.decoupled.HeightPair.toViewDU(readHeightPair(state.justifiedPair));
    state.finalizedSlot = state.justifiedSlot;
  }

  if (hasQuorum(state, TARGET_FLAG_INDEX)) {
    state.justifiedPair = ssz.decoupled.HeightPair.toViewDU(readHeightPair(state.targetPair));
    state.justifiedSlot = state.targetSlot;
    advanceHeight(state, true);
    return;
  }

  if (state.slot < state.targetSlot + timeoutDelayRounds * SLOTS_PER_ROUND) {
    return;
  }

  if (hasQuorum(state, PROGRESS_FLAG_INDEX)) {
    advanceHeight(state, false);
  }
}

/**
 * Fill the target root deferred by `advanceHeight` once `latest_block_header` carries its state root.
 * Called from `process_slot` with the block root it just computed.
 */
export function fillHeightTargetRoot(state: CachedBeaconStateDecoupled, latestBlockRoot: Root): void {
  if (state.latestBlockHeader.slot === state.targetSlot && isZeroRoot(state.targetPair.root)) {
    state.targetPair.root = latestBlockRoot;
  }
}
