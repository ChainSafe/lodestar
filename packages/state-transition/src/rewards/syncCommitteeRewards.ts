import {BeaconConfig} from "@lodestar/config";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {BeaconBlock, ValidatorIndex, altair, rewards} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../cache/stateCache.js";

export async function computeSyncCommitteeRewards(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  block: BeaconBlock,
  preState: CachedBeaconStateAllForks,
  validatorIds: (ValidatorIndex | string)[] = []
): Promise<rewards.SyncCommitteeRewards> {
  const fork = config.getForkName(block.slot);
  if (fork === ForkName.phase0) {
    throw Error("Cannot get sync rewards as phase0 block does not have sync committee");
  }

  const altairBlock = block as altair.BeaconBlock;
  const preStateAltair = preState.clone() as CachedBeaconStateAltair;

  // Bound syncCommitteeValidatorIndices in case it goes beyond SYNC_COMMITTEE_SIZE just to be safe
  const syncCommitteeValidatorIndices = preStateAltair.epochCtx.currentSyncCommitteeIndexed.validatorIndices.slice(
    0,
    SYNC_COMMITTEE_SIZE
  );
  const {syncParticipantReward} = preStateAltair.epochCtx;
  const {syncCommitteeBits} = altairBlock.body.syncAggregate;

  // Track reward deltas per validator (can appear multiple times in sync committee)
  const rewardDeltas: Map<ValidatorIndex, number> = new Map();

  // Iterate by position index to correctly access syncCommitteeBits
  for (let i = 0; i < syncCommitteeValidatorIndices.length; i++) {
    const validatorIndex = syncCommitteeValidatorIndices[i];
    const currentDelta = rewardDeltas.get(validatorIndex) ?? 0;
    if (syncCommitteeBits.get(i)) {
      // Positive rewards for participants
      rewardDeltas.set(validatorIndex, currentDelta + syncParticipantReward);
    } else {
      // Negative rewards for non participants
      rewardDeltas.set(validatorIndex, currentDelta - syncParticipantReward);
    }
  }

  const rewards = Array.from(rewardDeltas, ([validatorIndex, reward]) => ({validatorIndex, reward}));

  if (validatorIds.length) {
    const filtersSet = new Set(validatorIds);
    return rewards.filter(
      (reward) => filtersSet.has(reward.validatorIndex) || filtersSet.has(index2pubkey[reward.validatorIndex].toHex())
    );
  }

  return rewards;
}
