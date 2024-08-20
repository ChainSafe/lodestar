import {Epoch, RootHex, ValidatorIndex} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {toRootHex} from "@lodestar/utils/node";
import {
  DOMAIN_BEACON_ATTESTER,
  MAX_COMMITTEES_PER_SLOT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "@lodestar/params";
import {BeaconStateAllForks} from "../types.js";
import {getSeed} from "./seed.js";
import {unshuffleList} from "./shuffle.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {getBlockRootAtSlot} from "./blockRoot.js";

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

export function computeEpochShuffling(
  state: BeaconStateAllForks,
  activeIndices: ArrayLike<ValidatorIndex>,
  activeValidatorCount: number,
  epoch: Epoch
): EpochShuffling {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);

  if (activeValidatorCount > activeIndices.length) {
    throw new Error(`Invalid activeValidatorCount: ${activeValidatorCount} > ${activeIndices.length}`);
  }
  // only the first `activeValidatorCount` elements are copied to `activeIndices`
  const _activeIndices = new Uint32Array(activeValidatorCount);
  for (let i = 0; i < activeValidatorCount; i++) {
    _activeIndices[i] = activeIndices[i];
  }
  const shuffling = _activeIndices.slice();
  unshuffleList(shuffling, seed);

  const committeesPerSlot = computeCommitteeCount(activeValidatorCount);

  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;

  const committees: Uint32Array[][] = [];
  for (let slot = 0; slot < SLOTS_PER_EPOCH; slot++) {
    const slotCommittees: Uint32Array[] = [];
    for (let committeeIndex = 0; committeeIndex < committeesPerSlot; committeeIndex++) {
      const index = slot * committeesPerSlot + committeeIndex;
      const startOffset = Math.floor((activeValidatorCount * index) / committeeCount);
      const endOffset = Math.floor((activeValidatorCount * (index + 1)) / committeeCount);
      if (!(startOffset <= endOffset)) {
        throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
      }
      slotCommittees.push(shuffling.subarray(startOffset, endOffset));
    }
    committees.push(slotCommittees);
  }

  return {
    epoch,
    activeIndices: _activeIndices,
    shuffling,
    committees,
    committeesPerSlot,
  };
}

export function getShufflingDecisionBlock(state: BeaconStateAllForks, epoch: Epoch): RootHex {
  const pivotSlot = computeStartSlotAtEpoch(epoch - 1) - 1;
  return toRootHex(getBlockRootAtSlot(state, pivotSlot));
}
