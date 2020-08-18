import {Epoch, ValidatorIndex, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intDiv} from "@chainsafe/lodestar-utils";

import {getSeed, unshuffleList} from "../../util";
import {DomainType} from "../../constants";

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

export function computeCommitteeCount(config: IBeaconConfig, activeValidatorCount: number): number {
  const validatorsPerSlot = intDiv(activeValidatorCount, config.params.SLOTS_PER_EPOCH);
  let committeesPerSlot = intDiv(validatorsPerSlot, config.params.TARGET_COMMITTEE_SIZE);
  if (config.params.MAX_COMMITTEES_PER_SLOT < committeesPerSlot) {
    committeesPerSlot = config.params.MAX_COMMITTEES_PER_SLOT;
  }
  if (committeesPerSlot === 0) {
    committeesPerSlot = 1;
  }
  return committeesPerSlot;
}

export function computeEpochShuffling(
  config: IBeaconConfig,
  state: BeaconState,
  indicesBounded: [ValidatorIndex, Epoch, Epoch][],
  epoch: Epoch
): IEpochShuffling {
  const seed = getSeed(config, state, epoch, DomainType.BEACON_ATTESTER);

  const activeIndices: ValidatorIndex[] = [];
  indicesBounded.forEach(([index, activationEpoch, exitEpoch]) => {
    if (activationEpoch <= epoch && epoch < exitEpoch) {
      activeIndices.push(index);
    }
  });

  // copy
  const shuffling = activeIndices.slice();
  unshuffleList(config, shuffling, seed);

  const activeValidatorCount = activeIndices.length;
  const committeesPerSlot = computeCommitteeCount(config, activeValidatorCount);

  const committeeCount = committeesPerSlot * config.params.SLOTS_PER_EPOCH;

  const sliceCommittee = (slot: number, committeeIndex: number): ValidatorIndex[] => {
    const index = (slot * committeesPerSlot) + committeeIndex;
    const startOffset = intDiv(activeValidatorCount * index, committeeCount);
    const endOffset = intDiv(activeValidatorCount * (index + 1), committeeCount);
    if (!(startOffset <= endOffset)) {
      throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
    }
    return shuffling.slice(startOffset, endOffset);
  };

  const committees = Array.from({length: config.params.SLOTS_PER_EPOCH}, (_, slot) => {
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

