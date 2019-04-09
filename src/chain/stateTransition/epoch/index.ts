import assert from "assert";
import {BeaconState} from "../../../types";
import {SLOTS_PER_EPOCH} from "../../../constants";
import {processRewardsAndPenalties} from "./balanceUpdates";
import {processEth1Data} from "./eth1data";
import {processValidatorRegistryAndShuffleSeedData} from "./shuffling";
import {processEjections} from "./helpers";
import {processFinalUpdates} from "./finalUpdates";
import {processCrosslinks} from "./crosslinks";
import {processJustification} from "./justification";
import {processVariables} from "./variables";

export function shouldProcessEpoch(state: BeaconState): boolean {
  return (state.slot + 1) % SLOTS_PER_EPOCH === 0;
}

export function processEpoch(state: BeaconState): BeaconState {
  assert(shouldProcessEpoch(state));

  // Variables
  const {
    currentEpoch,
    previousEpoch,
    nextEpoch,
    currentTotalBalance,
    currentEpochAttestations,
    currentEpochBoundaryAttesterIndices,
    currentEpochBoundaryAttestingBalance,
    previousTotalBalance,
    previousEpochAttestations,
    previousEpochAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestations,
    previousEpochBoundaryAttesterIndices,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestations,
    previousEpochHeadAttesterIndices,
    previousEpochHeadAttestingBalance,
  } = processVariables(state);

  // Eth1 Data
  processEth1Data(state, nextEpoch);

  // Justification
  processJustification(
    state,
    currentEpoch,
    previousEpoch,
    previousEpochBoundaryAttestingBalance,
    currentEpochBoundaryAttestingBalance,
    currentTotalBalance,
    previousTotalBalance
  );

  // Crosslinks
  processCrosslinks(
    state,
    previousEpoch,
    nextEpoch,
    previousEpochAttestations,
    currentEpochAttestations
  );

  // Process Rewards and penalties
  processRewardsAndPenalties(
    state,
    currentEpoch,
    previousEpoch,
    nextEpoch,
    previousTotalBalance,
    previousEpochAttestations,
    previousEpochAttesterIndices,
    previousEpochBoundaryAttesterIndices,
    previousEpochHeadAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestingBalance
  );

  // Ejections
  processEjections(state);

  // Validator Registry and shuffling seed data
  processValidatorRegistryAndShuffleSeedData(state, currentEpoch, nextEpoch);

  // Final Updates
  processFinalUpdates(state, currentEpoch, nextEpoch);

  // assert(block.stateRoot ==== hashTreeRoot(state))
  return state;
}
