import {byteArrayEquals} from "@chainsafe/ssz";
import {Root, ssz, allForks} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {toHex} from "@lodestar/utils";
import {isValidMerkleBranch} from "../utils/verifyMerkleBranch.js";
import {isValidLightClientHeader} from "./utils.js";

const CURRENT_SYNC_COMMITTEE_INDEX = 22;
const CURRENT_SYNC_COMMITTEE_DEPTH = 5;

export function validateLightClientBootstrap(
  config: ChainForkConfig,
  trustedBlockRoot: Root,
  bootstrap: allForks.LightClientBootstrap
): void {
  const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(bootstrap.header.beacon);

  if (!isValidLightClientHeader(config, bootstrap.header)) {
    throw Error("Bootstrap Header is not Valid Light Client Header");
  }

  if (!byteArrayEquals(headerRoot, trustedBlockRoot)) {
    throw Error(`bootstrap header root ${toHex(headerRoot)} != trusted root ${toHex(trustedBlockRoot)}`);
  }

  if (
    !isValidMerkleBranch(
      ssz.altair.SyncCommittee.hashTreeRoot(bootstrap.currentSyncCommittee),
      bootstrap.currentSyncCommitteeBranch,
      CURRENT_SYNC_COMMITTEE_DEPTH,
      CURRENT_SYNC_COMMITTEE_INDEX,
      bootstrap.header.beacon.stateRoot
    )
  ) {
    throw Error("Invalid currentSyncCommittee merkle branch");
  }
}
