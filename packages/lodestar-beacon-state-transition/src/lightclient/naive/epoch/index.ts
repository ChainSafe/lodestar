import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient} from "@chainsafe/lodestar-types";
import {processJustificationAndFinalization} from "./justification_finalization";
import {processRewardsAndPenalties} from "./rewards_and_penalties";
import {phase0} from "../../..";
import {processSyncCommitteeUpdates} from "./sync_committee";
import {processParticipationFlagUpdates} from "./flag";

export * from "./justification_finalization";
export * from "./rewards_and_penalties";
export * from "./flag";
export * from "./sync_committee";

export function processEpoch(
  config: IBeaconConfig,
  state: lightclient.BeaconState & phase0.BeaconState
): lightclient.BeaconState {
  // Justification
  processJustificationAndFinalization(config, state);

  // Rewards and penalties
  processRewardsAndPenalties(config, state);

  // Validator Registry
  phase0.processRegistryUpdates(config, state);

  // Slashings
  phase0.processSlashings(config, state);

  phase0.processEth1DataReset(config, state);

  phase0.processEffectiveBalanceUpdates(config, state);

  phase0.processSlashingsReset(config, state);

  phase0.processRandaoMixesReset(config, state);

  phase0.processHistoricalRootsUpdate(config, state);

  processParticipationFlagUpdates(config, state);

  processSyncCommitteeUpdates(config, state);

  return state;
}
