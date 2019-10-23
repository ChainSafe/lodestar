/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {processRewardsAndPenalties} from "./balanceUpdates";
import {processCrosslinks} from "./crosslinks";
import {processFinalUpdates} from "./finalUpdates";
import {processJustificationAndFinalization} from "./justification";
import {processRegistryUpdates} from "./registryUpdates";
import {processSlashings} from "./slashings";

export * from "./balanceUpdates";
export * from "./crosslinks";
export * from "./finalUpdates";
export * from "./justification";
export * from "./registryUpdates";
export * from "./slashings";


export function processEpoch(config: IBeaconConfig, state: BeaconState): BeaconState {

  // Justification
  processJustificationAndFinalization(config, state);

  // Crosslinks
  processCrosslinks(config, state);

  // Rewards and penalties
  processRewardsAndPenalties(config, state);

  // Validator Registry
  processRegistryUpdates(config, state);

  // TODO Later Phase
  // processRevealDeadlines

  // TODO Later Phase
  // processChallengeDeadlines

  // Slashings
  processSlashings(config, state);

  // Final Updates
  processFinalUpdates(config, state);

  // TODO Later Phase
  // afterProcessFinalUpdates

  return state;
}
