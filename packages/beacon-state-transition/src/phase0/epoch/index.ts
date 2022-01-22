import {BeaconStateCachedPhase0, BeaconStateCachedAllForks, IEpochProcess} from "../../allForks/util";
import {
  processJustificationAndFinalization,
  processRegistryUpdates,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../allForks/epoch";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processSlashings} from "./processSlashings";
import {getAttestationDeltas} from "./getAttestationDeltas";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates";

export {processRewardsAndPenalties, processSlashings, getAttestationDeltas};

export function processEpoch(state: BeaconStateCachedPhase0, epochProcess: IEpochProcess): void {
  processJustificationAndFinalization(state as BeaconStateCachedAllForks, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as BeaconStateCachedAllForks, epochProcess);
  processSlashings(state, epochProcess);
  // inline processFinalUpdates() to follow altair and for clarity
  processEth1DataReset(state as BeaconStateCachedAllForks, epochProcess);
  processEffectiveBalanceUpdates(state as BeaconStateCachedAllForks, epochProcess);
  processSlashingsReset(state as BeaconStateCachedAllForks, epochProcess);
  processRandaoMixesReset(state as BeaconStateCachedAllForks, epochProcess);
  processHistoricalRootsUpdate(state as BeaconStateCachedAllForks, epochProcess);
  processParticipationRecordUpdates(state);
}
