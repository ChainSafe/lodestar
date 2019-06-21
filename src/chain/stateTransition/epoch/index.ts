/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../types";
import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "../../../constants";

import {processRewardsAndPenalties} from "./balanceUpdates";
import {processCrosslinks} from "./crosslinks";
import {processFinalUpdates} from "./finalUpdates";
import {processJustificationAndFinalization} from "./justification";
import {processRegistryUpdates} from "./registryUpdates";
import {processSlashings} from "./slashings";

export function shouldProcessEpoch(state: BeaconState): boolean {
  return state.slot > GENESIS_SLOT && (state.slot + 1) % SLOTS_PER_EPOCH === 0;
}

export function processEpoch(state: BeaconState): BeaconState {

  // Justification
  processJustificationAndFinalization(state);

  // Crosslinks
  processCrosslinks(state);

  // Rewards and penalties
  processRewardsAndPenalties(state);

  // Validator Registry
  processRegistryUpdates(state);

  // TODO
  //processReveal_deadlines

  // TODO
  //processChallenge_deadlines

  // Slashings
  processSlashings(state);

  // Final Updates
  processFinalUpdates(state);

  return state;
}
