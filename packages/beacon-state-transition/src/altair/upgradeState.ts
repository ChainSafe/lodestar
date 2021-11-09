import {allForks, altair, ParticipationFlags, phase0, ssz, Uint8} from "@chainsafe/lodestar-types";
import {CachedBeaconState, createCachedBeaconState} from "../allForks/util";
import {newZeroedArray} from "../util";
import {List, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IParticipationStatus} from "../allForks/util/cachedEpochParticipation";
import {getAttestationParticipationStatus, RootCache} from "./block/processAttestation";
import {getNextSyncCommittee} from "./util/syncCommittee";

/**
 * Upgrade a state from phase0 to altair.
 */
export function upgradeState(state: CachedBeaconState<phase0.BeaconState>): CachedBeaconState<altair.BeaconState> {
  const {config} = state;
  const pendingAttesations = Array.from(state.previousEpochAttestations);
  const postTreeBackedState = upgradeTreeBackedState(config, state);
  const postState = createCachedBeaconState(config, postTreeBackedState);
  translateParticipation(postState, pendingAttesations);
  return postState;
}

function upgradeTreeBackedState(
  config: IBeaconConfig,
  state: CachedBeaconState<phase0.BeaconState>
): TreeBacked<altair.BeaconState> {
  const nextEpochActiveIndices = state.nextShuffling.activeIndices;
  const stateTB = ssz.phase0.BeaconState.createTreeBacked(state.tree);
  const validatorCount = stateTB.validators.length;
  const epoch = state.currentShuffling.epoch;
  // TODO: Does this preserve the hashing cache? In altair devnets memory spikes on the fork transition
  const postState = ssz.altair.BeaconState.createTreeBacked(stateTB.tree);
  postState.fork = {
    previousVersion: stateTB.fork.currentVersion,
    currentVersion: config.ALTAIR_FORK_VERSION,
    epoch,
  };
  postState.previousEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.currentEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.inactivityScores = newZeroedArray(validatorCount) as List<Uint8>;
  const syncCommittee = getNextSyncCommittee(state, nextEpochActiveIndices, state.epochCtx.effectiveBalances);
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
  const {epochCtx} = state;
  const rootCache = new RootCache(state as CachedBeaconState<allForks.BeaconState>);
  const epochParticipation = state.previousEpochParticipation;
  for (const attestation of pendingAttesations) {
    const data = attestation.data;
    const {timelySource, timelyTarget, timelyHead} = getAttestationParticipationStatus(
      data,
      attestation.inclusionDelay,
      rootCache,
      epochCtx
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
