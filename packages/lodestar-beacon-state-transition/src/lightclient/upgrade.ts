import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Lightclient, PendingAttestation} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {getCurrentEpoch} from "..";

export const LIGHTCLIENT_PATCH_FORK_VERSION = Buffer.from("0x01000000", "hex");

export function upgrade(config: IBeaconConfig, pre: BeaconState): Lightclient.BeaconState {
  const epoch = getCurrentEpoch(config, pre);
  return {
    ...pre,
    fork: {
      previousVersion: pre.fork.currentVersion,
      currentVersion: LIGHTCLIENT_PATCH_FORK_VERSION,
      epoch,
    },
    previousEpochAttestations: new Array<PendingAttestation>() as List<PendingAttestation>,
    currentEpochAttestations: new Array<PendingAttestation>() as List<PendingAttestation>,
    currentSyncCommittee: config.types.lightclient.SyncCommittee.defaultValue(),
    nextSyncCommittee: config.types.lightclient.SyncCommittee.defaultValue(),
  };
}
