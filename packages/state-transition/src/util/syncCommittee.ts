import {aggregateSerializedPublicKeys} from "@chainsafe/lodestar-z/blst";
import {ChainConfig} from "@lodestar/config";
import {
  BASE_REWARD_FACTOR,
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
  SYNC_REWARD_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {Epoch, altair} from "@lodestar/types";
import {bigIntSqrt} from "@lodestar/utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {BeaconStateAllForks} from "../types.js";
import {getNextSyncCommitteeIndices} from "./seed.js";
import {getSlotDurationMsAtEpoch} from "./slot.js";

/**
 * Return the sync committee for a given state and epoch.
 *
 * SLOW CODE - 🐢
 */
export function getNextSyncCommittee(
  fork: ForkSeq,
  state: BeaconStateAllForks,
  activeValidatorIndices: Uint32Array,
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): {indices: Uint32Array; syncCommittee: altair.SyncCommittee} {
  const indices = getNextSyncCommitteeIndices(fork, state, activeValidatorIndices, effectiveBalanceIncrements);

  // Using the index2pubkey cache is slower because it needs the serialized pubkey.
  const pubkeys = [];
  for (const index of indices) {
    pubkeys.push(state.validators.getReadonly(index).pubkey);
  }

  return {
    indices,
    syncCommittee: {
      pubkeys,
      aggregatePubkey: aggregateSerializedPublicKeys(pubkeys).toBytes(),
    },
  };
}

/**
 * Same logic in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#sync-committee-processing
 */
export function computeSyncParticipantReward(
  config: ChainConfig,
  epoch: Epoch,
  totalActiveBalanceIncrements: number
): number {
  const baseRewardPerIncrement = computeBaseRewardPerIncrement(config, epoch, totalActiveBalanceIncrements);
  const totalBaseRewards = baseRewardPerIncrement * totalActiveBalanceIncrements;
  const maxParticipantRewards = Math.floor(
    Math.floor((totalBaseRewards * SYNC_REWARD_WEIGHT) / WEIGHT_DENOMINATOR) / SLOTS_PER_EPOCH
  );
  return Math.floor(maxParticipantRewards / SYNC_COMMITTEE_SIZE);
}

/**
 * Before we manage bigIntSqrt(totalActiveStake) as BigInt and return BigInt.
 * bigIntSqrt(totalActiveStake) should fit a number (2 ** 53 -1 max)
 **/
export function computeBaseRewardPerIncrement(
  config: ChainConfig,
  epoch: Epoch,
  totalActiveStakeByIncrement: number
): number {
  // EIP-8198: scale by the slot duration ratio, dividing last so the exact ratio applies
  const slotDurationMs = getSlotDurationMsAtEpoch(config, epoch);
  return Math.floor(
    Math.floor((EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR * slotDurationMs) / config.SLOT_DURATION_MS) /
      Number(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}
