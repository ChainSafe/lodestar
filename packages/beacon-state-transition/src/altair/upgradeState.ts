import {altair, ParticipationFlags, phase0, ssz, Uint8} from "@chainsafe/lodestar-types";
import {CachedBeaconState, createCachedBeaconState} from "../allForks/util";
import {getBlockRoot, getBlockRootAtSlot, getCurrentEpoch, newZeroedArray} from "../util";
import {List, TreeBacked} from "@chainsafe/ssz";
import {getSyncCommittee} from "./state_accessor";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IParticipationStatus} from "../allForks/util/cachedEpochParticipation";

/**
 * Upgrade a state from phase0 to altair.
 */
export function upgradeState(state: CachedBeaconState<phase0.BeaconState>): CachedBeaconState<altair.BeaconState> {
  const {config} = state;
  const pendingAttesations = Array.from(state.previousEpochAttestations);
  const postTreeBackedState = upgradeTreeBackedState(config, ssz.phase0.BeaconState.createTreeBacked(state.tree));
  const postState = createCachedBeaconState(config, postTreeBackedState);
  translateParticipation(postState, pendingAttesations);
  return postState;
}

function upgradeTreeBackedState(
  config: IBeaconConfig,
  state: TreeBacked<phase0.BeaconState>
): TreeBacked<altair.BeaconState> {
  const validatorCount = state.validators.length;
  const epoch = getCurrentEpoch(state);
  const postState = ssz.altair.BeaconState.createTreeBacked(state.tree);
  postState.fork = {
    previousVersion: state.fork.currentVersion,
    currentVersion: config.ALTAIR_FORK_VERSION,
    epoch,
  };
  postState.previousEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.currentEpochParticipation = newZeroedArray(validatorCount) as List<ParticipationFlags>;
  postState.inactivityScores = newZeroedArray(validatorCount) as List<Uint8>;
  const syncCommittee = getSyncCommittee(state, epoch);
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
  const currentEpoch = state.currentShuffling.epoch;
  for (const attestation of pendingAttesations) {
    const data = attestation.data;
    let justifiedCheckpoint;
    if (data.target.epoch === currentEpoch) {
      justifiedCheckpoint = state.currentJustifiedCheckpoint;
    } else {
      justifiedCheckpoint = state.previousJustifiedCheckpoint;
    }
    const isMatchingSource = ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
    if (!isMatchingSource) {
      throw new Error(
        "Attestation source does not equal justified checkpoint: " +
          `source=${JSON.stringify(ssz.phase0.Checkpoint.toJson(data.source))} ` +
          `justifiedCheckpoint=${JSON.stringify(ssz.phase0.Checkpoint.toJson(justifiedCheckpoint))}`
      );
    }
    const isMatchingTarget = ssz.Root.equals(data.target.root, getBlockRoot(state, data.target.epoch));
    const isMatchingHead =
      isMatchingTarget && ssz.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(state, data.slot));
    const attestingIndices = state.getAttestingIndices(data, attestation.aggregationBits);
    for (const index of attestingIndices) {
      const status = epochParticipation.getStatus(index) as IParticipationStatus;
      const newStatus = {
        timelyHead: status.timelyHead || isMatchingHead,
        timelySource: true,
        timelyTarget: status.timelyTarget || isMatchingTarget,
      };
      epochParticipation.setStatus(index, newStatus);
    }
  }
}
