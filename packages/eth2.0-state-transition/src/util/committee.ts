/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  Epoch,
  ValidatorIndex,
  CompactCommittee,
  BeaconState,
  Hash,
  Shard,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {computeShuffledIndex, getSeed} from "./seed";
import {getActiveValidatorIndices, computeCompactValidator} from "./validator";
import {getCurrentEpoch} from "./epoch";
import {intDiv} from "@chainsafe/eth2.0-utils";


/**
 * Return the [[index]]'th shuffled committee out of a total [[count]]
 * using [[indices]] and [[seed]].
 */
export function computeCommittee(
  config: IBeaconConfig,
  indices: ValidatorIndex[],
  seed: Hash,
  index: number,
  count: number
): ValidatorIndex[] {
  const start = intDiv(indices.length * index, count);
  const end = intDiv(indices.length * (index + 1), count);
  return Array.from({length: end - start},
    (_, i) => i + start)
    .map((i) => indices[computeShuffledIndex(config, i, indices.length, seed)]);
}

/**
 * Return the number of committees at [[epoch]].
 */
export function getCommitteeCount(config: IBeaconConfig, state: BeaconState, epoch: Epoch): number {
  const activeValidatorIndices = getActiveValidatorIndices(state, epoch);
  return Math.max(
    1,
    Math.min(
      intDiv(config.params.SHARD_COUNT, config.params.SLOTS_PER_EPOCH),
      intDiv(intDiv(activeValidatorIndices.length, config.params.SLOTS_PER_EPOCH), config.params.TARGET_COMMITTEE_SIZE),
    ),
  ) * config.params.SLOTS_PER_EPOCH;
}

/**
 * Return the number of shards to increment [[state.latestStartShard]] at [[epoch]].
 */
export function getShardDelta(config: IBeaconConfig, state: BeaconState, epoch: Epoch): number {
  return Math.min(
    getCommitteeCount(config, state, epoch),
    config.params.SHARD_COUNT - intDiv(config.params.SHARD_COUNT, config.params.SLOTS_PER_EPOCH),
  );
}

/**
 * Return the start shard of the 0th committee at [[epoch]].
 */
export function getStartShard(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Shard {
  const currentEpoch = getCurrentEpoch(config, state);
  let checkEpoch = currentEpoch + 1;
  assert(epoch <= checkEpoch);
  const shardDelta = getShardDelta(config, state, currentEpoch);
  let shard = (state.startShard + shardDelta) % config.params.SHARD_COUNT;
  while (checkEpoch > epoch) {
    checkEpoch -= 1;
    shard = (shard + config.params.SHARD_COUNT - shardDelta) % config.params.SHARD_COUNT;
  }
  return shard;
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 */
export function getCrosslinkCommittee(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch,
  shard: Shard
): ValidatorIndex[] {
  return computeCommittee(
    config,
    getActiveValidatorIndices(state, epoch),
    getSeed(config, state, epoch),
    (shard + config.params.SHARD_COUNT - getStartShard(config, state, epoch)) % config.params.SHARD_COUNT,
    getCommitteeCount(config, state, epoch)
  );
}

/**
 * Return the compact committee root at [[epoch]].
 */
export function getCompactCommitteesRoot(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Hash {
  const committees: CompactCommittee[] = Array.from({length: config.params.SHARD_COUNT},
    () => ({pubkeys: [], compactValidators: []}));
  const startShard = getStartShard(config, state, epoch);
  for (let committeeNumber = 0; committeeNumber < getCommitteeCount(config, state, epoch); committeeNumber++) {
    const shard = (startShard + committeeNumber) % config.params.SHARD_COUNT;
    getCrosslinkCommittee(config, state, epoch, shard).forEach((index) => {
      const validator = state.validators[index];
      committees[shard].pubkeys.push(validator.pubkey);
      committees[shard].compactValidators.push(computeCompactValidator(config, validator, index));
    });
  }
  return hashTreeRoot({
    elementType: config.types.CompactCommittee,
    length: config.params.SHARD_COUNT,
  }, committees);
}
