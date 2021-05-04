import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {processJustificationAndFinalization} from "./justification_finalization";
import {processRewardsAndPenalties} from "./rewards_and_penalties";
import * as phase0 from "../../../phase0";
import {processSyncCommitteeUpdates} from "./sync_committee";
import {processParticipationFlagUpdates} from "./flag";
import {processInactivityUpdates} from "./inactivity_updates";
import {processSlashings} from "./slashings";

export * from "./justification_finalization";
export * from "./rewards_and_penalties";
export * from "./flag";
export * from "./sync_committee";

export function processEpoch(
  config: IBeaconConfig,
  state: altair.BeaconState & phase0.BeaconState
): altair.BeaconState {
  // Justification
  processJustificationAndFinalization(config, state);

  processInactivityUpdates(config, state);

  // Rewards and penalties
  processRewardsAndPenalties(config, state);

  // Validator Registry
  phase0.processRegistryUpdates(config, state);

  // Slashings
  processSlashings(config, state);

  phase0.processEth1DataReset(config, state);

  phase0.processEffectiveBalanceUpdates(config, state);

  phase0.processSlashingsReset(config, state);

  phase0.processRandaoMixesReset(config, state);

  phase0.processHistoricalRootsUpdate(config, state);

  processParticipationFlagUpdates(config, state);

  processSyncCommitteeUpdates(config, state);

  return state;
}
