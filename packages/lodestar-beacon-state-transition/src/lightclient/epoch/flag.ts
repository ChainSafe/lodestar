import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient, ValidatorFlag} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";

/**
 * Call to ``process_participation_flag_updates`` added to ``process_epoch`` in HF1
 */
export function processParticipationFlagUpdates(config: IBeaconConfig, state: lightclient.BeaconState): void {
  state.previousEpochParticipation = state.currentEpochParticipation;
  state.currentEpochParticipation = Array.from({length: state.validators.length}, () => 0) as List<ValidatorFlag>;
}
