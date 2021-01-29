import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Lightclient, PendingAttestation} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {getCurrentEpoch} from "..";

export function upgrade(config: IBeaconConfig, pre: BeaconState): Lightclient.BeaconState {
  const epoch = getCurrentEpoch(config, pre);
  return {
    ...pre,
    fork: {
      previousVersion: pre.fork.currentVersion,
      currentVersion: config.params.lightclient.LIGHTCLIENT_PATCH_FORK_VERSION,
      epoch,
    },
    previousEpochAttestations: new Array<PendingAttestation>() as List<PendingAttestation>,
    currentEpochAttestations: new Array<PendingAttestation>() as List<PendingAttestation>,
    currentSyncCommittee: config.types.lightclient.SyncCommittee.defaultValue(),
    nextSyncCommittee: config.types.lightclient.SyncCommittee.defaultValue(),
  };
}
