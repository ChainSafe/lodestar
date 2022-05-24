import {Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  DOMAIN_BEACON_ATTESTER,
  MAX_COMMITTEES_PER_SLOT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";
import {BeaconStateAllForks} from "../types.js";
import {getSeed} from "./seed.js";
import {unshuffleList} from "./shuffle.js";

/**
 * Readonly interface for IEpochShuffling.
 */
export interface IReadonlyEpochShuffling {
  readonly epoch: Epoch;
  readonly committees: Readonly<ValidatorIndex[][][]>;
}

export interface IEpochShuffling {
  /**
   * Epoch being shuffled
   */
  epoch: Epoch;

  /**
   * Non-shuffled active validator indices
   */
  activeIndices: ValidatorIndex[];

  /**
   * The active validator indices, shuffled into their committee
   */
  shuffling: ValidatorIndex[];

  /**
   * List of list of committees Committees
   *
   * Committees by index, by slot
   *
   * Note: With a high amount of shards, or low amount of validators,
   * some shards may not have a committee this epoch
   */
  committees: ValidatorIndex[][][];

  /**
   * Committees per slot, for fast attestation verification
   */
  committeesPerSlot: number;
}

export function computeCommitteeCount(activeValidatorCount: number): number {
  const validatorsPerSlot = intDiv(activeValidatorCount, SLOTS_PER_EPOCH);
  const committeesPerSlot = intDiv(validatorsPerSlot, TARGET_COMMITTEE_SIZE);
  return Math.max(1, Math.min(MAX_COMMITTEES_PER_SLOT, committeesPerSlot));
}

export function computeEpochShuffling(
  state: BeaconStateAllForks,
  activeIndices: ValidatorIndex[],
  epoch: Epoch
): IEpochShuffling {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);

  // copy
  const shuffling = activeIndices.slice();
  unshuffleList(shuffling, seed);

  const activeValidatorCount = activeIndices.length;
  const committeesPerSlot = computeCommitteeCount(activeValidatorCount);

  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;

  const committees: ValidatorIndex[][][] = [];
  for (let slot = 0; slot < SLOTS_PER_EPOCH; slot++) {
    const slotCommittees: ValidatorIndex[][] = [];
    for (let committeeIndex = 0; committeeIndex < committeesPerSlot; committeeIndex++) {
      const index = slot * committeesPerSlot + committeeIndex;
      const startOffset = Math.floor((activeValidatorCount * index) / committeeCount);
      const endOffset = Math.floor((activeValidatorCount * (index + 1)) / committeeCount);
      if (!(startOffset <= endOffset)) {
        throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
      }
      slotCommittees.push(shuffling.slice(startOffset, endOffset));
    }
    committees.push(slotCommittees);
  }

  return {
    epoch,
    activeIndices,
    shuffling,
    committees,
    committeesPerSlot,
  };
}
