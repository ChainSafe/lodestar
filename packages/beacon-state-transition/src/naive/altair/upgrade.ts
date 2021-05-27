import {List} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, altair, ParticipationFlags, Uint8, ssz} from "@chainsafe/lodestar-types";

import {getCurrentEpoch, newZeroedArray} from "../../util";

export function upgrade(config: IBeaconConfig, pre: phase0.BeaconState): altair.BeaconState {
  const epoch = getCurrentEpoch(pre);
  const validatorCount = pre.validators.length;
  const {previousEpochAttestations: _1, currentEpochAttestations: _2, ...old} = pre;
  return {
    ...(old as Omit<phase0.BeaconState, "previousEpochAttestations" | "currentEpochAttestations">),
    fork: {
      previousVersion: pre.fork.currentVersion,
      currentVersion: config.ALTAIR_FORK_VERSION,
      epoch,
    },
    previousEpochParticipation: newZeroedArray(validatorCount) as List<ParticipationFlags>,
    currentEpochParticipation: newZeroedArray(validatorCount) as List<ParticipationFlags>,
    inactivityScores: newZeroedArray(validatorCount) as List<Uint8>,
    currentSyncCommittee: ssz.altair.SyncCommittee.defaultValue(),
    nextSyncCommittee: ssz.altair.SyncCommittee.defaultValue(),
  };
}
