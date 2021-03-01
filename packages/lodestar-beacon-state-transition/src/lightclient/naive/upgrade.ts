import {List} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, lightclient, ValidatorFlag} from "@chainsafe/lodestar-types";

import {getCurrentEpoch} from "../../util";

export function upgrade(config: IBeaconConfig, pre: phase0.BeaconState): lightclient.BeaconState {
  const epoch = getCurrentEpoch(config, pre);
  return {
    ...pre,
    fork: {
      previousVersion: pre.fork.currentVersion,
      currentVersion: config.params.LIGHTCLIENT_PATCH_FORK_VERSION,
      epoch,
    },
    previousEpochAttestations: new Array<phase0.PendingAttestation>() as List<phase0.PendingAttestation>,
    currentEpochAttestations: new Array<phase0.PendingAttestation>() as List<phase0.PendingAttestation>,
    previousEpochParticipation: Array.from({length: pre.validators.length}, () => 0) as List<ValidatorFlag>,
    currentEpochParticipation: Array.from({length: pre.validators.length}, () => 0) as List<ValidatorFlag>,
    currentSyncCommittee: config.types.lightclient.SyncCommittee.defaultValue(),
    nextSyncCommittee: config.types.lightclient.SyncCommittee.defaultValue(),
  };
}
