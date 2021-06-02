import {altair, ParticipationFlags, phase0, Uint8} from "@chainsafe/lodestar-types";
import {CachedBeaconState, createCachedBeaconState} from "../allForks/util";
import {getCurrentEpoch, newZeroedArray} from "../util";
import {List, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IParticipationStatus} from "../allForks/util/cachedEpochParticipation";
import {getAttestationParticipationStatus} from "./block/processAttestation";
import {getNextSyncCommittee} from "./epoch/sync_committee";

/**
 * Upgrade a state from phase0 to altair.
 */
export function upgradeState(state: CachedBeaconState<phase0.BeaconState>): CachedBeaconState<altair.BeaconState> {
  const {config} = state;
  const pendingAttesations = Array.from(state.previousEpochAttestations);
  const postTreeBackedState = upgradeTreeBackedState(
    config,
    config.types.phase0.BeaconState.createTreeBacked(state.tree)
  );
  const postState = createCachedBeaconState(config, postTreeBackedState);
  translateParticipation(postState, pendingAttesations);
  return postState;
}

function upgradeTreeBackedState(
  config: IBeaconConfig,
  state: TreeBacked<phase0.BeaconState>
): TreeBacked<altair.BeaconState> {
  const validatorCount = state.validators.length;
  const epoch = getCurrentEpoch(config, state);
  const postState = config.types.altair.BeaconState.createTreeBacked(state.tree);
  postState.fork = {
    previousVersion: state.fork.currentVersion,
    currentVersion: config.params.ALTAIR_FORK_VERSION,
    epoch,
  };
  postState.previousEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.currentEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.inactivityScores = newZeroedArray(validatorCount) as List<Uint8>;
  const syncCommittee = getNextSyncCommittee(config, state);
  postState.currentSyncCommittee = syncCommittee;
  postState.nextSyncCommittee = syncCommittee;
  return postState;
}

/**
 * Translate_participation in https://github.com/ethereum/eth2.0-specs/blob/dev/specs/altair/fork.md
 */
function translateParticipation(
  state: CachedBeaconState<altair.BeaconState>,
  pendingAttesations: phase0.PendingAttestation[]
): void {
  const epochParticipation = state.previousEpochParticipation;
  for (const attestation of pendingAttesations) {
    const data = attestation.data;
    const {timelySource, timelyTarget, timelyHead} = getAttestationParticipationStatus(
      state,
      data,
      attestation.inclusionDelay
    );

    const attestingIndices = state.getAttestingIndices(data, attestation.aggregationBits);
    for (const index of attestingIndices) {
      const status = epochParticipation.getStatus(index) as IParticipationStatus;
      const newStatus = {
        timelySource: status.timelySource || timelySource,
        timelyTarget: status.timelyTarget || timelyTarget,
        timelyHead: status.timelyHead || timelyHead,
      };
      epochParticipation.setStatus(index, newStatus);
    }
  }
}
