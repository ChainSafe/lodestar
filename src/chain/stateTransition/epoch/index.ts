/**
 * @module chain/stateTransition/epoch
 */

import assert from "assert";

import {BeaconState} from "../../../types";
import {SLOTS_PER_EPOCH, GENESIS_SLOT} from "../../../constants";

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
  assert(shouldProcessEpoch(state));

  // Justification
  processJustificationAndFinalization(state);

  // Crosslinks
  processCrosslinks(state);

  // Rewards and penalties
  processRewardsAndPenalties(state);

  // Validator Registry
  processRegistryUpdates(state);

  // Slashings
  processSlashings(state);

  // Final Updates
  processFinalUpdates(state);

  return state;
}
