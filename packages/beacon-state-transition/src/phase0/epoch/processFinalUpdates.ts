import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IEpochProcess, CachedBeaconState} from "../../allForks/util";
import {
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../allForks/epoch";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates";

export function processFinalUpdates(state: CachedBeaconState<phase0.BeaconState>, epochProcess: IEpochProcess): void {
  processEth1DataReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processEffectiveBalanceUpdates(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processSlashingsReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processRandaoMixesReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processHistoricalRootsUpdate(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processParticipationRecordUpdates(state);
}
