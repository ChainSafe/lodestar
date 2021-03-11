/**
 * @module chain/stateTransition/util
 */

import {ValidatorIndex, CommitteeIndex, Slot, Bytes32, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeShuffledIndex, getSeed} from "./seed";
import {getActiveValidatorIndices} from "./validator";
import {computeEpochAtSlot} from "./epoch";
import {intDiv} from "@chainsafe/lodestar-utils";

/**
 * Return the [[index]]'th shuffled committee out of a total [[count]]
 * using [[indices]] and [[seed]].
 */
export function computeCommittee(
  config: IBeaconConfig,
  indices: ValidatorIndex[],
  seed: Bytes32,
  index: number,
  count: number
): ValidatorIndex[] {
  const start = intDiv(indices.length * index, count);
  const end = intDiv(indices.length * (index + 1), count);
  return Array.from({length: end - start}, (_, i) => i + start).map(
    (i) => indices[computeShuffledIndex(config, i, indices.length, seed)]
  );
}

/**
 * Return the number of committees at [[epoch]].
 * Return the number of committees at [[slot]].
 */
export function getCommitteeCountAtSlot(config: IBeaconConfig, state: allForks.BeaconState, slot: Slot): number {
  const epoch = computeEpochAtSlot(config, slot);
  const activeValidatorIndices = getActiveValidatorIndices(state, epoch);
  return Math.max(
    1,
    Math.min(
      config.params.MAX_COMMITTEES_PER_SLOT,
      intDiv(intDiv(activeValidatorIndices.length, config.params.SLOTS_PER_EPOCH), config.params.TARGET_COMMITTEE_SIZE)
    )
  );
}

/**
 * Return the beacon committee at [[slot]] for [[index]].
 */
export function getBeaconCommittee(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  slot: Slot,
  index: CommitteeIndex
): ValidatorIndex[] {
  const epoch = computeEpochAtSlot(config, slot);
  const committeesPerSlot = getCommitteeCountAtSlot(config, state, slot);
  return computeCommittee(
    config,
    getActiveValidatorIndices(state, epoch),
    getSeed(config, state, epoch, config.params.DOMAIN_BEACON_ATTESTER),
    (slot % config.params.SLOTS_PER_EPOCH) * committeesPerSlot + index,
    committeesPerSlot * config.params.SLOTS_PER_EPOCH
  );
}
