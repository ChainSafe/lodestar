import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  getAttesterSlashableIndices,
  processAttestationsAltair,
} from "@lodestar/state-transition";
import {ValidatorIndex, allForks, altair, phase0} from "@lodestar/types";
import {ForkName, WHISTLEBLOWER_REWARD_QUOTIENT} from "@lodestar/params";


export type SyncCommitteeRewards = {
  validatorIndex: ValidatorIndex;
  reward: number;
}[];

export async function computeSyncCommitteeRewards(block: allForks.BeaconBlock,   state: CachedBeaconStateAllForks, filters?: (ValidatorIndex | string)[]): Promise<SyncCommitteeRewards> {
  const fork = state.config.getForkName(block.slot);
  if (fork === ForkName.phase0) {
    throw Error("Cannot get sync rewards as phase0 block does not have sync committee!");
  }

  return [];
}