import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Epoch} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from ".";
import {getWeakSubjectivityCheckpointEpoch} from "../../util/weakSubjectivity";

/**
 * Returns the epoch of the latest weak subjectivity checkpoint for the given
  `state` and `safetyDecay`. The default `safetyDecay` used should be 10% (= 0.1)
 */
export function getLatestWeakSubjectivityCheckpointEpoch(
  config: IBeaconConfig,
  state: CachedBeaconState<allForks.BeaconState>,
  safetyDecay = 0.1
): Epoch {
  const valCount = state.epochCtx.currentShuffling.activeIndices.length;
  return getWeakSubjectivityCheckpointEpoch(config, state.finalizedCheckpoint.epoch, valCount, safetyDecay);
}
