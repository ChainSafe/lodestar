/**
 * @module chain/stateTransition
 */

export * from "./constants";
export * from "./util";
export * from "./metrics";

export * as phase0 from "./phase0";
export * as altair from "./altair";
export * as bellatrix from "./bellatrix";
export * as allForks from "./allForks";

export {
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStateAllForks,
  // Non-cached states
  BeaconStatePhase0,
  BeaconStateAltair,
  BeaconStateBellatrix,
  BeaconStateAllForks,
} from "./types";

// Main state caches
export {createCachedBeaconState, BeaconStateCache} from "./cache/stateCache";
export {EpochContext, EpochContextImmutableData, createEmptyEpochContextImmutableData} from "./cache/epochContext";
export {EpochProcess, beforeProcessEpoch} from "./cache/epochProcess";

// Aux data-structures
export {PubkeyIndexMap, Index2PubkeyCache} from "./cache/pubkeyCache";
export {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsZeroed} from "./cache/effectiveBalanceIncrements";
