import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "@lodestar/state-transition";
import {ValidatorIndex, allForks, altair} from "@lodestar/types";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";

// Note: This excludes sync aggregate reward. The reward for proposer here only reflect the sync committee participation portion
export type SyncCommitteeRewards = {
  validatorIndex: ValidatorIndex;
  reward: number;
}[];

export async function computeSyncCommitteeRewards(
  block: allForks.BeaconBlock,
  preState: CachedBeaconStateAllForks,
  filters?: (ValidatorIndex | string)[]
): Promise<SyncCommitteeRewards> {
  const fork = preState.config.getForkName(block.slot);
  if (fork === ForkName.phase0) {
    throw Error("Cannot get sync rewards as phase0 block does not have sync committee!");
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
  const balances: Map<ValidatorIndex, {val: number}> = new Map(
    committeeIndices.map((i) => [i, {val: preStateAltair.balances.get(i)}])
  ); // Use val for convenient way to increment/decrement balance

  for (const i of committeeIndices) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const balanceRecord = balances.get(i)!; // We are certain i is in balances
    if (syncCommitteeBits.get(i)) {
      // Positive rewards for participants
      balanceRecord.val += syncParticipantReward;
    } else {
      // Negative rewards for non participants
      balanceRecord.val = Math.max(0, balanceRecord.val - syncParticipantReward);
    }
  }

  const rewards = Array.from(balances, ([validatorIndex, v]) => ({validatorIndex, reward: v.val}));

  if (filters !== undefined) {
    // Might be a bit slow. But this is only called by rewards api which is insensitive to performance
    return rewards.filter(
      (reward) =>
        filters.includes(reward.validatorIndex) || filters.includes(index2pubkey[reward.validatorIndex].toHex())
    );
  } else {
    return Array.from(balances, ([validatorIndex, v]) => ({validatorIndex, reward: v.val}));
  }
}
