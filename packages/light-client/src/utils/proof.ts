import {Path} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function getSyncCommitteesProofPaths(config: IBeaconConfig): Path[] {
  const paths: Path[] = [];
  for (let i = 0; i < config.params.SYNC_COMMITTEE_SIZE; i++) {
    // hacky, but fetch both the first and second half of the pubkeys
    paths.push(["currentSyncCommittee", "pubkeys", i, 0]);
    paths.push(["currentSyncCommittee", "pubkeys", i, 32]);
    paths.push(["nextSyncCommittee", "pubkeys", i, 0]);
    paths.push(["nextSyncCommittee", "pubkeys", i, 32]);
  }
  for (let i = 0; i < Math.floor(config.params.SYNC_COMMITTEE_SIZE / config.params.SYNC_PUBKEYS_PER_AGGREGATE); i++) {
    paths.push(["currentSyncCommittee", "pubkeyAggregates", i, 0]);
    paths.push(["currentSyncCommittee", "pubkeyAggregates", i, 32]);
    paths.push(["nextSyncCommittee", "pubkeyAggregates", i, 0]);
    paths.push(["nextSyncCommittee", "pubkeyAggregates", i, 32]);
  }
  return paths;
}
