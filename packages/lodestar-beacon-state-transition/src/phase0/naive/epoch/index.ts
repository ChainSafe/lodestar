/**
 * @module chain/stateTransition/epoch
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {processEth1DataReset} from "..";
import {processRewardsAndPenalties} from "./balanceUpdates";
import {processJustificationAndFinalization} from "./justification";
import {processRegistryUpdates} from "./registryUpdates";
import {processSlashings, processSlashingsReset} from "./slashings";
import {processEffectiveBalanceUpdates} from "./effective_balance";
import {processRandaoMixesReset} from "./randao";
import {processHistoricalRootsUpdate} from "./historical_roots";
import {processParticipationRecordUpdates} from "./participation_records";

export * from "./balanceUpdates";
export * from "./eth1";
export * from "./justification";
export * from "./registryUpdates";
export * from "./slashings";
export * from "./effective_balance";
export * from "./randao";
export * from "./historical_roots";
export * from "./participation_records";

export function processEpoch(config: IBeaconConfig, state: phase0.BeaconState): phase0.BeaconState {
  // Justification
  processJustificationAndFinalization(config, state);

  // Rewards and penalties
  processRewardsAndPenalties(config, state);

  // Validator Registry
  processRegistryUpdates(config, state);

  // Slashings
  processSlashings(config, state);

  processEth1DataReset(config, state);

  processEffectiveBalanceUpdates(config, state);

  processSlashingsReset(config, state);

  processRandaoMixesReset(config, state);

  processHistoricalRootsUpdate(config, state);

  processParticipationRecordUpdates(config, state);

  return state;
}
