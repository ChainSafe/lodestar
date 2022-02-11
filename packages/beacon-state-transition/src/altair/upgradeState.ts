import {altair, ParticipationFlags, phase0, ssz, Uint8} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0, CachedBeaconStateAltair, CachedBeaconStateAllForks} from "../types";
import {createCachedBeaconState} from "../cache/cachedBeaconState";
import {newZeroedArray} from "../util";
import {List, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getAttestationParticipationStatus, RootCache} from "./block/processAttestation";
import {getNextSyncCommittee} from "../util/syncCommittee";

/**
 * Upgrade a state from phase0 to altair.
 */
export function upgradeState(state: CachedBeaconStatePhase0): CachedBeaconStateAltair {
  const {config} = state;
  const pendingAttesations = Array.from(state.previousEpochAttestations);
  const postTreeBackedState = upgradeTreeBackedState(config, state);
  const postState = createCachedBeaconState(config, postTreeBackedState);
  translateParticipation(postState, pendingAttesations);
  return postState;
}

function upgradeTreeBackedState(config: IBeaconConfig, state: CachedBeaconStatePhase0): TreeBacked<altair.BeaconState> {
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
  const syncCommittee = getNextSyncCommittee(state, nextEpochActiveIndices, state.epochCtx.effectiveBalanceIncrements);
  postState.currentSyncCommittee = syncCommittee;
  postState.nextSyncCommittee = syncCommittee;
  return postState;
}

/**
 * Translate_participation in https://github.com/ethereum/eth2.0-specs/blob/dev/specs/altair/fork.md
 */
function translateParticipation(state: CachedBeaconStateAltair, pendingAttesations: phase0.PendingAttestation[]): void {
  const {epochCtx} = state;
  const rootCache = new RootCache(state as CachedBeaconStateAllForks);
  const epochParticipation = state.previousEpochParticipation;
  for (const attestation of pendingAttesations) {
    const data = attestation.data;
    const flagsAttestation = getAttestationParticipationStatus(data, attestation.inclusionDelay, rootCache, epochCtx);

    const attestingIndices = state.getAttestingIndices(data, attestation.aggregationBits);
    for (const index of attestingIndices) {
      const flags = epochParticipation.get(index) as ParticipationFlags;
      // Merge (OR) `flagsAttestation` (new flags) with `flags` (current flags)
      epochParticipation.set(index, flags | flagsAttestation);
    }
  }
}
