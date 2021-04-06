import {allForks, phase0} from "@chainsafe/lodestar-types";
import {
  IEpochProcess,
  CachedBeaconState,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../../fast";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates";

export function processFinalUpdates(state: CachedBeaconState<phase0.BeaconState>, process: IEpochProcess): void {
  processEth1DataReset(state as CachedBeaconState<allForks.BeaconState>, process);
  processEffectiveBalanceUpdates(state as CachedBeaconState<allForks.BeaconState>, process);
  processSlashingsReset(state as CachedBeaconState<allForks.BeaconState>, process);
  processRandaoMixesReset(state as CachedBeaconState<allForks.BeaconState>, process);
  processHistoricalRootsUpdate(state as CachedBeaconState<allForks.BeaconState>, process);
  processParticipationRecordUpdates(state);
}
