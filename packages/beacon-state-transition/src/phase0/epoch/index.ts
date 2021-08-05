import {CachedBeaconState, IEpochProcess, prepareEpochProcessState} from "../../allForks/util";
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
import {allForks, phase0} from "@chainsafe/lodestar-types";

export {processRewardsAndPenalties, processSlashings, getAttestationDeltas};

export function processEpoch(state: CachedBeaconState<phase0.BeaconState>): IEpochProcess {
  const epochProcess = prepareEpochProcessState(state);
  processJustificationAndFinalization(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processSlashings(state, epochProcess);
  // inline processFinalUpdates() to follow altair and for clarity
  processEth1DataReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processEffectiveBalanceUpdates(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processSlashingsReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processRandaoMixesReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processHistoricalRootsUpdate(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processParticipationRecordUpdates(state);
  return epochProcess;
}
