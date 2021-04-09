import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, ParticipationFlags} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {newZeroedArray} from "../../../util";

/**
 * Call to ``process_participation_flag_updates`` added to ``process_epoch`` in HF1
 */
export function processParticipationFlagUpdates(config: IBeaconConfig, state: altair.BeaconState): void {
  state.previousEpochParticipation = state.currentEpochParticipation;
  state.currentEpochParticipation = newZeroedArray(state.validators.length) as List<ParticipationFlags>;
}
