import {Epoch, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  DOMAIN_BEACON_ATTESTER,
  MAX_COMMITTEES_PER_SLOT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";

import {getSeed, unshuffleList} from "../../util";

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
}

export function computeCommitteeCount(activeValidatorCount: number): number {
  const validatorsPerSlot = intDiv(activeValidatorCount, SLOTS_PER_EPOCH);
  let committeesPerSlot = intDiv(validatorsPerSlot, TARGET_COMMITTEE_SIZE);
  if (MAX_COMMITTEES_PER_SLOT < committeesPerSlot) {
    committeesPerSlot = MAX_COMMITTEES_PER_SLOT;
  }
  if (committeesPerSlot === 0) {
    committeesPerSlot = 1;
  }
  return committeesPerSlot;
}

export function computeEpochShuffling(
  state: allForks.BeaconState,
  indicesBounded: [ValidatorIndex, Epoch, Epoch][],
  epoch: Epoch
): IEpochShuffling {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);

  const activeIndices: ValidatorIndex[] = [];
  for (const [index, activationEpoch, exitEpoch] of indicesBounded) {
    if (activationEpoch <= epoch && epoch < exitEpoch) {
      activeIndices.push(index);
    }
  }

  // copy
  const shuffling = activeIndices.slice();
  unshuffleList(shuffling, seed);

  const activeValidatorCount = activeIndices.length;
  const committeesPerSlot = computeCommitteeCount(activeValidatorCount);

  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;

  const sliceCommittee = (slot: number, committeeIndex: number): ValidatorIndex[] => {
    const index = slot * committeesPerSlot + committeeIndex;
    const startOffset = Math.floor((activeValidatorCount * index) / committeeCount);
    const endOffset = Math.floor((activeValidatorCount * (index + 1)) / committeeCount);
    if (!(startOffset <= endOffset)) {
      throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
    }
    return shuffling.slice(startOffset, endOffset);
  };

  const committees = Array.from({length: SLOTS_PER_EPOCH}, (_, slot) => {
    return Array.from({length: committeesPerSlot}, (_, committeeIndex) => {
      return sliceCommittee(slot, committeeIndex);
    });
  });

  return {
    epoch,
    activeIndices,
    shuffling,
    committees,
  };
}
