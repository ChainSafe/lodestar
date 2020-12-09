import {CachedValidatorsBeaconState, prepareEpochProcessState} from "../util";
import {StateTransitionEpochContext} from "../util/epochContext";
import {processJustificationAndFinalization} from "./processJustificationAndFinalization";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processRegistryUpdates} from "./processRegistryUpdates";
import {processSlashings} from "./processSlashings";
import {processFinalUpdates} from "./processFinalUpdates";
import {processForkChanged} from "./processFork";
import {getAttestationDeltas} from "./getAttestationDeltas";

export {
  processJustificationAndFinalization,
  processRewardsAndPenalties,
  processRegistryUpdates,
  processSlashings,
  processFinalUpdates,
  processForkChanged,
  getAttestationDeltas,
};

export function processEpoch(epochCtx: StateTransitionEpochContext, state: CachedValidatorsBeaconState): void {
  const process = prepareEpochProcessState(epochCtx, state);
  epochCtx.epochProcess = process;
  processJustificationAndFinalization(epochCtx, process, state);
  processRewardsAndPenalties(epochCtx, process, state);
  processRegistryUpdates(epochCtx, process, state);
  processSlashings(epochCtx, process, state);
  processFinalUpdates(epochCtx, process, state);
  processForkChanged(epochCtx, process, state);
}
