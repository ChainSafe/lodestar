/**
 * @module chain/stateTransition/util
 */

import {ValidatorIndex, CommitteeIndex, Slot, Bytes32, allForks} from "@chainsafe/lodestar-types";
import {computeShuffledIndex, getSeed} from "./seed";
import {getActiveValidatorIndices} from "./validator";
import {computeEpochAtSlot} from "./epoch";
import {intDiv} from "@chainsafe/lodestar-utils";
import {
  DOMAIN_BEACON_ATTESTER,
  MAX_COMMITTEES_PER_SLOT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";

/**
 * Return the [[index]]'th shuffled committee out of a total [[count]]
 * using [[indices]] and [[seed]].
 */
export function computeCommittee(
  indices: ValidatorIndex[],
  seed: Bytes32,
  index: number,
  count: number
): ValidatorIndex[] {
  const start = intDiv(indices.length * index, count);
  const end = intDiv(indices.length * (index + 1), count);
  return Array.from({length: end - start}, (_, i) => i + start).map(
    (i) => indices[computeShuffledIndex(i, indices.length, seed)]
  );
}

/**
 * Return the number of committees at [[epoch]].
 * Return the number of committees at [[slot]].
 */
export function getCommitteeCountAtSlot(state: allForks.BeaconState, slot: Slot): number {
  const epoch = computeEpochAtSlot(slot);
  const activeValidatorIndices = getActiveValidatorIndices(state, epoch);
  return Math.max(
    1,
    Math.min(
      MAX_COMMITTEES_PER_SLOT,
      intDiv(intDiv(activeValidatorIndices.length, SLOTS_PER_EPOCH), TARGET_COMMITTEE_SIZE)
    )
  );
}

/**
 * Return the beacon committee at [[slot]] for [[index]].
 */
export function getBeaconCommittee(state: allForks.BeaconState, slot: Slot, index: CommitteeIndex): ValidatorIndex[] {
  const epoch = computeEpochAtSlot(slot);
  const committeesPerSlot = getCommitteeCountAtSlot(state, slot);
  return computeCommittee(
    getActiveValidatorIndices(state, epoch),
    getSeed(state, epoch, DOMAIN_BEACON_ATTESTER),
    (slot % SLOTS_PER_EPOCH) * committeesPerSlot + index,
    committeesPerSlot * SLOTS_PER_EPOCH
  );
}
