import {Path} from "@chainsafe/ssz";
import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";

export function getSyncCommitteesProofPaths(): Path[] {
  const paths: Path[] = [];
  for (let i = 0; i < SYNC_COMMITTEE_SIZE; i++) {
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
