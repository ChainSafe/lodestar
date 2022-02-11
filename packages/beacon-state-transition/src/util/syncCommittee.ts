import {aggregatePublicKeys} from "@chainsafe/bls";
import {
  BASE_REWARD_FACTOR,
  EFFECTIVE_BALANCE_INCREMENT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
  SYNC_REWARD_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {allForks, altair, ValidatorIndex} from "@chainsafe/lodestar-types";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements";
import {getNextSyncCommitteeIndices} from "./seed";

/**
 * Return the sync committee for a given state and epoch.
 *
 * SLOW CODE - 🐢
 */
export function getNextSyncCommittee(
  state: allForks.BeaconState,
  activeValidatorIndices: ValidatorIndex[],
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): altair.SyncCommittee {
  const indices = getNextSyncCommitteeIndices(state, activeValidatorIndices, effectiveBalanceIncrements);
  // Using the index2pubkey cache is slower because it needs the serialized pubkey.
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  return {
    pubkeys,
    aggregatePubkey: aggregatePublicKeys(pubkeys.map((pubkey) => pubkey.valueOf() as Uint8Array)),
  };
}

/**
 * Same logic in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#sync-committee-processing
 */
export function computeSyncParticipantReward(totalActiveBalanceIncrements: number): number {
  const totalActiveBalance = BigInt(totalActiveBalanceIncrements) * BigInt(EFFECTIVE_BALANCE_INCREMENT);
  const baseRewardPerIncrement = Math.floor(
    (EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR) / Number(bigIntSqrt(totalActiveBalance))
  );
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
export function computeBaseRewardPerIncrement(totalActiveStakeByIncrement: number): number {
  return Math.floor(
    (EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR) /
      Number(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}
