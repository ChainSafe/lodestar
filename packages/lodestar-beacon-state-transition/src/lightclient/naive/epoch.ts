import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient} from "@chainsafe/lodestar-types";

import {phase0} from "../../";
import {getCurrentEpoch} from "../../util";
import {getSyncCommittee} from "./sync_committee";

export function processFinalUpdates(config: IBeaconConfig, state: lightclient.BeaconState): void {
  phase0.processFinalUpdates(config, state);
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
