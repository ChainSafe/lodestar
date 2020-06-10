import {BeaconState} from "@chainsafe/lodestar-types";

import {prepareEpochProcessState, EpochContext} from "../util";
import {processJustificationAndFinalization} from "./processJustificationAndFinalization";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processRegistryUpdates} from "./processRegistryUpdates";
import {processSlashings} from "./processSlashings";
import {processFinalUpdates} from "./processFinalUpdates";
import {processForkChanged} from "./processFork";

export {
  processJustificationAndFinalization,
  processRewardsAndPenalties,
  processRegistryUpdates,
  processSlashings,
  processFinalUpdates,
};


export function processEpoch(epochCtx: EpochContext, state: BeaconState): void {
  const process = prepareEpochProcessState(epochCtx, state);
  processJustificationAndFinalization(epochCtx, process, state);
  processRewardsAndPenalties(epochCtx, process, state);
  processRegistryUpdates(epochCtx, process, state);
  processSlashings(epochCtx, process, state);
  processFinalUpdates(epochCtx, process, state);
  processForkChanged(epochCtx, process, state);
}
