import {byteArrayEquals} from "@chainsafe/ssz";
import {altair, Root, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {isValidMerkleBranch} from "../utils/verifyMerkleBranch.js";

const CURRENT_SYNC_COMMITTEE_INDEX = 22;
const CURRENT_SYNC_COMMITTEE_DEPTH = 5;

export function validateLightClientBootstrap(trustedBlockRoot: Root, bootstrap: altair.LightClientBootstrap): void {
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
}
