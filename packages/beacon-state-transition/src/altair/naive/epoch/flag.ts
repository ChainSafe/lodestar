import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, ParticipationFlags} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";

/**
 * Call to ``process_participation_flag_updates`` added to ``process_epoch`` in HF1
 */
export function processParticipationFlagUpdates(config: IBeaconConfig, state: altair.BeaconState): void {
  state.previousEpochParticipation = state.currentEpochParticipation;
  state.currentEpochParticipation = Array.from({length: state.validators.length}, () => 0) as List<ParticipationFlags>;
}
