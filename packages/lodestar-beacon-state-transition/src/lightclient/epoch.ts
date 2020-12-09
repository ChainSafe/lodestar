import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LightClient} from "@chainsafe/lodestar-types";
import {processFinalUpdates as phase0ProcessFinalUpdates} from "../epoch/finalUpdates";
import {getCurrentEpoch} from "../util";
import {getSyncCommittee} from "./sync_committee";

export function processFinalUpdates(config: IBeaconConfig, state: LightClient.BeaconState): void {
  phase0ProcessFinalUpdates(config, state);
  const nextEpoch = getCurrentEpoch(config, state) + 1;
  if (nextEpoch % config.params.lightclient.EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0) {
    state.currentSyncCommittee = state.nextSyncCommittee;
    state.nextSyncCommittee = getSyncCommittee(
      config,
      state,
      nextEpoch + config.params.lightclient.EPOCHS_PER_SYNC_COMMITTEE_PERIOD
    );
  }
}
