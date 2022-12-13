import {byteArrayEquals} from "@chainsafe/ssz";
import {altair, Root, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {LightClientStore} from "../types.js";
import {deserializeSyncCommittee} from "../utils/utils.js";
import {isValidMerkleBranch} from "../utils/verifyMerkleBranch.js";

const CURRENT_SYNC_COMMITTEE_INDEX = 22;
const CURRENT_SYNC_COMMITTEE_DEPTH = 5;

export function initializeLightClientStore(
  trustedBlockRoot: Root,
  bootstrap: altair.LightClientBootstrap
): LightClientStore {
  const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(bootstrap.header);
  if (!byteArrayEquals(headerRoot, trustedBlockRoot)) {
    throw Error(`bootstrap header root ${toHex(headerRoot)} != trusted root ${toHex(trustedBlockRoot)}`);
  }

  if (
    !isValidMerkleBranch(
      ssz.altair.SyncCommittee.hashTreeRoot(bootstrap.currentSyncCommittee),
      bootstrap.currentSyncCommitteeBranch,
      CURRENT_SYNC_COMMITTEE_DEPTH,
      CURRENT_SYNC_COMMITTEE_INDEX,
      bootstrap.header.stateRoot
    )
  ) {
    throw Error("Invalid next sync committee merkle branch");
  }

  return {
    finalizedHeader: bootstrap.header,
    currentSyncCommittee: deserializeSyncCommittee(bootstrap.currentSyncCommittee),
    nextSyncCommittee: null,
    bestValidUpdate: null,
    optimisticHeader: bootstrap.header,
    previousMaxActiveParticipants: 0,
    currentMaxActiveParticipants: 0,
  };
}
