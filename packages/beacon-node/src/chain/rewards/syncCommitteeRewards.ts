import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "@lodestar/state-transition";
import {BeaconBlock, ValidatorIndex, altair} from "@lodestar/types";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {routes} from "@lodestar/api";

export type SyncCommitteeRewards = routes.beacon.SyncCommitteeRewards;
type BalanceRecord = {val: number}; // Use val for convenient way to increment/decrement balance

export async function computeSyncCommitteeRewards(
  block: BeaconBlock,
  preState: CachedBeaconStateAllForks,
  validatorIds: (ValidatorIndex | string)[] = []
): Promise<SyncCommitteeRewards> {
  const fork = preState.config.getForkName(block.slot);
  if (fork === ForkName.phase0) {
    throw Error("Cannot get sync rewards as phase0 block does not have sync committee");
  }

  const altairBlock = block as altair.BeaconBlock;
  const preStateAltair = preState as CachedBeaconStateAltair;
  const {index2pubkey} = preStateAltair.epochCtx;

  // Bound committeeIndices in case it goes beyond SYNC_COMMITTEE_SIZE just to be safe
  const committeeIndices = preStateAltair.epochCtx.currentSyncCommitteeIndexed.validatorIndices.slice(
    0,
    SYNC_COMMITTEE_SIZE
  );
  const {syncParticipantReward} = preStateAltair.epochCtx;
  const {syncCommitteeBits} = altairBlock.body.syncAggregate;

  // Use balance of each committee as starting point such that we cap the penalty to avoid balance dropping below 0
  const balances: Map<ValidatorIndex, BalanceRecord> = new Map(
    committeeIndices.map((i) => [i, {val: preStateAltair.balances.get(i)}])
  );

  for (const i of committeeIndices) {
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
