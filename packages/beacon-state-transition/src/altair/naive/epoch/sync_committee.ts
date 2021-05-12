import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {getSyncCommittee} from "../../state_accessor";
import {getCurrentEpoch} from "../../../util";

/**
 * Call to ``proces_sync_committee_updates`` added to ``process_epoch`` in HF1
 */
export function processSyncCommitteeUpdates(config: IBeaconConfig, state: altair.BeaconState): void {
  const nextEpoch = getCurrentEpoch(config, state) + 1;
  if (nextEpoch % config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = getSyncCommittee(
      config,
      state,
      nextEpoch + config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
    );
  }
}
