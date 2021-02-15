import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Lightclient} from "@chainsafe/lodestar-types";
import {processJustificationAndFinalization} from "./justification_finalization";
import {processRewardsAndPenalties} from "./rewards_and_penalties";
import {processRegistryUpdates, processSlashings, processFinalUpdates} from "../..";
import {processSyncCommitteeUpdates} from "./sync_committee";
import {processParticipationFlagUpdates} from "./flag";

export * from "./justification_finalization";
export * from "./rewards_and_penalties";
export * from "./flag";
export * from "./sync_committee";

export function processEpoch(config: IBeaconConfig, state: Lightclient.BeaconState): Lightclient.BeaconState {
  // Justification
  processJustificationAndFinalization(config, state);

  // Rewards and penalties
  processRewardsAndPenalties(config, state);

  // Validator Registry
  processRegistryUpdates(config, state);

  // Slashings
  processSlashings(config, state);

  // Final Updates
  processFinalUpdates(config, state);

  processParticipationFlagUpdates(config, state);

  processSyncCommitteeUpdates(config, state);

  return state;
}
