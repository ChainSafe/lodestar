import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Number64, Phase1, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, computeStartSlotAtEpoch, getCurrentEpoch} from "../../util/epoch";
import {getActiveValidatorIndices} from "../..";
import {List, hash} from "@chainsafe/ssz";
import {computeCommitteeSourceEpoch} from "../misc/committee";
import {getSeed} from "../../util/seed";
import {computeCommittee} from "../../util";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {bytesToBigInt} from "../../../../lodestar-utils/src/bytes";
import {slashing} from "../../../../lodestar-cli/src/cmds/account/cmds/validator/slashingProtection/index";
import {computeOffsetSlots} from "../misc/slot";

/**
 * Return the number of committees in each slot for the given ``epoch``.
 * Updated from phase0;
 */
export function getCommitteeCountPerSlot(config: IBeaconConfig, state: Phase1.BeaconState, epoch: Epoch): Number64 {
  return Math.max(1, Math.min(getActiveShardCount(config, state), getActiveValidatorIndices(state, epoch).length));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getActiveShardCount(config: IBeaconConfig, state: Phase1.BeaconState): Number64 {
  return config.params.phase1.INITIAL_ACTIVE_SHARDS;
}

export function getOnlineValidatorIndices(config: IBeaconConfig, state: Phase1.BeaconState): Set<ValidatorIndex> {
  const activeValidators = getActiveValidatorIndices(state, getCurrentEpoch(config, state));
  return new Set(activeValidators.filter((_, index) => state.onlineCountdown[index] !== 0));
}

/**
 * Return the shard committee of the given ``epoch`` of the given ``shard``.
 */
export function getShardCommittee(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  epoch: Epoch,
  shard: Phase1.Shard
): ValidatorIndex[] {
  const sourceEpoch = computeCommitteeSourceEpoch(epoch, config.params.SHARD_COMMITTEE_PERIOD);
  const activeValidatorIndices = getActiveValidatorIndices(state, sourceEpoch);
  const seed = getSeed(config, state, sourceEpoch, config.params.phase1.DOMAIN_SHARD_COMMITTEE);
  return computeCommittee(config, activeValidatorIndices, seed, shard, getActiveShardCount(config, state));
}

/**
 * Return the light client committee of no more than ``LIGHT_CLIENT_COMMITTEE_SIZE`` validators.
 */
export function getLightClientCommittee(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  epoch: Epoch
): ValidatorIndex[] {
  const sourceEpoch = computeCommitteeSourceEpoch(epoch, config.params.phase1.LIGHT_CLIENT_COMMITTEE_PERIOD);
  const activeValidatorIndices = getActiveValidatorIndices(state, sourceEpoch);
  const seed = getSeed(config, state, sourceEpoch, config.params.phase1.DOMAIN_LIGHT_CLIENT);
  return computeCommittee(config, activeValidatorIndices, seed, 0, getActiveShardCount(config, state)).slice(
    0,
    config.params.phase1.LIGHT_CLIENT_COMMITTEE_SIZE
  );
}

/**
 * Return the proposer's index of shard block at ``slot``.
 */
export function getShardProposerIndex(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  slot: Slot,
  shard: Phase1.Shard
): ValidatorIndex {
  const epoch = computeEpochAtSlot(config, slot);
  const committee = getShardCommittee(config, state, epoch, shard);
  const seed = hash(getSeed(config, state, epoch, config.params.phase1.DOMAIN_SHARD_COMMITTEE), intToBytes(slot, 8));
  const r = bytesToBigInt(seed.slice(0, 8), "le");
  return committee[Number(r % BigInt(committee.length))];
}

/**
 * Return the sum of committee counts in range ``[start_slot, stop_slot)``
 */
export function getCommitteeCountDelta(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  startSlot: Slot,
  stopSlot: Slot
): Number64 {
  let delta = 0;
  for (let slot = startSlot; slot < stopSlot; slot++) {
    delta += getCommitteeCountPerSlot(config, state, computeEpochAtSlot(config, slot));
  }
  return delta;
}

/**
 * Return the start shard at ``slot``.
 */
export function getStartShard(config: IBeaconConfig, state: Phase1.BeaconState, slot: Slot): Phase1.Shard {
  const currentEpochStartSlot = computeStartSlotAtEpoch(config, getCurrentEpoch(config, state));
  const activeShardCount = getActiveShardCount(config, state);
  if (currentEpochStartSlot === slot) {
    return state.currentEpochStartShard;
  } else if (slot > currentEpochStartSlot) {
    const shardDelta = getCommitteeCountDelta(config, state, slot, currentEpochStartSlot);
    return (state.currentEpochStartShard + shardDelta) % activeShardCount;
  } else {
    const shardDelta = getCommitteeCountDelta(config, state, slot, currentEpochStartSlot);
    const maxCommitteesPerSlot = activeShardCount;
    const maxCommitteesInSpan = maxCommitteesPerSlot + (currentEpochStartSlot - slot);
    return (state.currentEpochStartShard + maxCommitteesInSpan - shardDelta) % activeShardCount;
  }
}

/**
 * Return the latest slot number of the given ``shard``.
 */
export function getLatestSlotForShard(state: Phase1.BeaconState, shard: Phase1.Shard): Slot {
  return state.shardStates[shard].slot;
}

/**
 *  Return the offset slots of the given ``shard``.
 *  The offset slot are after the latest slot and before current slot.
 */
export function getOffsetSlots(config: IBeaconConfig, state: Phase1.BeaconState, shard: Phase1.Shard): Slot[] {
  return computeOffsetSlots(config, getLatestSlotForShard(state, shard), state.slot);
}
