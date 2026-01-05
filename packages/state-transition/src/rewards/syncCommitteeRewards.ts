import {BeaconConfig} from "@lodestar/config";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {BeaconBlock, ValidatorIndex, altair, rewards} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../cache/stateCache.js";

type BalanceRecord = {val: number}; // Use val for convenient way to increment/decrement balance

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
  const preStateAltair = preState as CachedBeaconStateAltair;

  // Bound syncCommitteeValidatorIndices in case it goes beyond SYNC_COMMITTEE_SIZE just to be safe
  const syncCommitteeValidatorIndices = preStateAltair.epochCtx.currentSyncCommitteeIndexed.validatorIndices.slice(
    0,
    SYNC_COMMITTEE_SIZE
  );
  const {syncParticipantReward} = preStateAltair.epochCtx;
  const {syncCommitteeBits} = altairBlock.body.syncAggregate;

  // Use balance of each committee as starting point such that we cap the penalty to avoid balance dropping below 0
  const balances: Map<ValidatorIndex, BalanceRecord> = new Map();
  for (const i of syncCommitteeValidatorIndices) {
    balances.set(i, {val: preStateAltair.balances.get(i)});
  }

  for (const i of syncCommitteeValidatorIndices) {
    const balanceRecord = balances.get(i) as BalanceRecord;
    if (syncCommitteeBits.get(i)) {
      // Positive rewards for participants
      balanceRecord.val += syncParticipantReward;
    } else {
      // Negative rewards for non participants
      balanceRecord.val = Math.max(0, balanceRecord.val - syncParticipantReward);
    }
  }

  const rewards = Array.from(balances, ([validatorIndex, v]) => ({validatorIndex, reward: v.val}));

  if (validatorIds.length) {
    const filtersSet = new Set(validatorIds);
    return rewards.filter(
      (reward) => filtersSet.has(reward.validatorIndex) || filtersSet.has(index2pubkey[reward.validatorIndex].toHex())
    );
  }

  return rewards;
}
