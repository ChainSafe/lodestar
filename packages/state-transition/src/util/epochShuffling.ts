import {asyncUnshuffleList, unshuffleList} from "@chainsafe/swap-or-not-shuffle";
import {BeaconConfig} from "@lodestar/config";
import {
  DOMAIN_BEACON_ATTESTER,
  GENESIS_SLOT,
  MAX_COMMITTEES_PER_SLOT,
  SHUFFLE_ROUND_COUNT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "@lodestar/params";
import {Epoch, RootHex, ValidatorIndex, ssz} from "@lodestar/types";
import {intDiv, toRootHex} from "@lodestar/utils";
import {BeaconStateAllForks} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeAnchorCheckpoint} from "./computeAnchorCheckpoint.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {getSeed} from "./seed.js";

/**
 * Readonly interface for EpochShuffling.
 */
export type ReadonlyEpochShuffling = {
  readonly epoch: Epoch;
  readonly committees: Readonly<ValidatorIndex[][][]>;
};

export type EpochShuffling = {
  /**
   * Epoch being shuffled
   */
  epoch: Epoch;

  /**
   * Non-shuffled active validator indices
   */
  activeIndices: Uint32Array;

  /**
   * The active validator indices, shuffled into their committee
   */
  shuffling: Uint32Array;

  /**
   * List of list of committees Committees
   *
   * Committees by index, by slot
   *
   * Note: With a high amount of shards, or low amount of validators,
   * some shards may not have a committee this epoch
   */
  committees: Uint32Array[][];

  /**
   * Committees per slot, for fast attestation verification
   */
  committeesPerSlot: number;
};

export function computeCommitteeCount(activeValidatorCount: number): number {
  const validatorsPerSlot = intDiv(activeValidatorCount, SLOTS_PER_EPOCH);
  const committeesPerSlot = intDiv(validatorsPerSlot, TARGET_COMMITTEE_SIZE);
  return Math.max(1, Math.min(MAX_COMMITTEES_PER_SLOT, committeesPerSlot));
}

function buildCommitteesFromShuffling(shuffling: Uint32Array): Uint32Array[][] {
  const activeValidatorCount = shuffling.length;
  const committeesPerSlot = computeCommitteeCount(activeValidatorCount);
  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;

  const committees = new Array<Uint32Array[]>(SLOTS_PER_EPOCH);
  for (let slot = 0; slot < SLOTS_PER_EPOCH; slot++) {
    const slotCommittees = new Array<Uint32Array>(committeesPerSlot);

    for (let committeeIndex = 0; committeeIndex < committeesPerSlot; committeeIndex++) {
      const index = slot * committeesPerSlot + committeeIndex;
      const startOffset = Math.floor((activeValidatorCount * index) / committeeCount);
      const endOffset = Math.floor((activeValidatorCount * (index + 1)) / committeeCount);
      if (!(startOffset <= endOffset)) {
        throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
      }
      slotCommittees[committeeIndex] = shuffling.subarray(startOffset, endOffset);
    }

    committees[slot] = slotCommittees;
  }

  return committees;
}

export function computeEpochShuffling(
  // TODO: (@matthewkeil) remove state/epoch and pass in seed to clean this up
  state: BeaconStateAllForks,
  activeIndices: Uint32Array,
  epoch: Epoch
): EpochShuffling {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);
  const shuffling = unshuffleList(activeIndices, seed, SHUFFLE_ROUND_COUNT);
  const committees = buildCommitteesFromShuffling(shuffling);
  return {
    epoch,
    activeIndices,
    shuffling,
    committees,
    committeesPerSlot: committees[0].length,
  };
}

export async function computeEpochShufflingAsync(
  // TODO: (@matthewkeil) remove state/epoch and pass in seed to clean this up
  state: BeaconStateAllForks,
  activeIndices: Uint32Array,
  epoch: Epoch
): Promise<EpochShuffling> {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);
  const shuffling = await asyncUnshuffleList(activeIndices, seed, SHUFFLE_ROUND_COUNT);
  const committees = buildCommitteesFromShuffling(shuffling);
  return {
    epoch,
    activeIndices,
    shuffling,
    committees,
    committeesPerSlot: committees[0].length,
  };
}

export function calculateDecisionRoot(state: BeaconStateAllForks, epoch: Epoch): RootHex {
  const pivotSlot = Math.max(GENESIS_SLOT, computeStartSlotAtEpoch(epoch - 1) - 1);
  return toRootHex(getBlockRootAtSlot(state, pivotSlot));
}

/**
 * Get the shuffling decision block root for the given epoch of given state.
 * Mirrors `forkchoice.getDependentRoot()` so attestation shuffling lookups hit
 * the cache when syncing from genesis.
 *
 * Special case close to genesis: when the pivot slot is at or before
 * GENESIS_SLOT, return the anchor block root. The naive `state.slot > GENESIS_SLOT`
 * guard misses states that have been process_slots-advanced past genesis but
 * still resolve to a pre-genesis pivot slot (e.g. state.slot=1, epoch=0 →
 * pivotSlot=-33), causing shuffling lookups to miss and regen to fail.
 */
export function calculateShufflingDecisionRoot(
  config: BeaconConfig,
  state: BeaconStateAllForks,
  epoch: Epoch
): RootHex {
  const pivotSlot = computeStartSlotAtEpoch(epoch - 1) - 1;
  if (pivotSlot <= GENESIS_SLOT) {
    return toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(computeAnchorCheckpoint(config, state).blockHeader));
  }
  return calculateDecisionRoot(state, epoch);
}
