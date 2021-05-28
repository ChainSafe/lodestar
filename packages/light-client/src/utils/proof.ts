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
  paths.push(["currentSyncCommittee", "aggregatePubkey", 0]);
  paths.push(["currentSyncCommittee", "aggregatePubkey", 32]);
  paths.push(["nextSyncCommittee", "aggregatePubkey", 0]);
  paths.push(["nextSyncCommittee", "aggregatePubkey", 32]);
  return paths;
}
