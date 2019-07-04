/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../../types";

import {processRewardsAndPenalties} from "./balanceUpdates";
import {processCrosslinks} from "./crosslinks";
import {processFinalUpdates} from "./finalUpdates";
import {processJustificationAndFinalization} from "./justification";
import {processRegistryUpdates} from "./registryUpdates";
import {processSlashings} from "./slashings";

export function processEpoch(state: BeaconState): BeaconState {

  // Justification
  processJustificationAndFinalization(state);

  // Crosslinks
  processCrosslinks(state);

  // Rewards and penalties
  processRewardsAndPenalties(state);

  // Validator Registry
  processRegistryUpdates(state);

  // TODO Later Phase
  // processRevealDeadlines

  // TODO Later Phase
  // processChallengeDeadlines

  // Slashings
  processSlashings(state);

  // Final Updates
  processFinalUpdates(state);

  // TODO Later Phase
  // afterProcessFinalUpdates

  return state;
}
