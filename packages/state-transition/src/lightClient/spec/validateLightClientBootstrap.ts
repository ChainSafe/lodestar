import {ChainForkConfig} from "@lodestar/config";
import {LightClientBootstrap, Root, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex} from "@lodestar/utils";
import {currentSyncCommitteeGindexAtFork, isValidLightClientHeader, isValidNormalizedMerkleBranch} from "./utils.js";

export function validateLightClientBootstrap(
  config: ChainForkConfig,
  trustedBlockRoot: Root,
  bootstrap: LightClientBootstrap
): void {
  const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(bootstrap.header.beacon);
  const fork = config.getForkName(bootstrap.header.beacon.slot);

  if (!isValidLightClientHeader(config, bootstrap.header)) {
    throw Error("Bootstrap Header is not Valid Light Client Header");
  }

  if (!byteArrayEquals(headerRoot, trustedBlockRoot)) {
    throw Error(`bootstrap header root ${toHex(headerRoot)} != trusted root ${toHex(trustedBlockRoot)}`);
  }

  if (
    !isValidNormalizedMerkleBranch(
      ssz.altair.SyncCommittee.hashTreeRoot(bootstrap.currentSyncCommittee),
      bootstrap.currentSyncCommitteeBranch,
      currentSyncCommitteeGindexAtFork(fork),
      bootstrap.header.beacon.stateRoot
    )
  ) {
    throw Error("Invalid currentSyncCommittee merkle branch");
  }
}
