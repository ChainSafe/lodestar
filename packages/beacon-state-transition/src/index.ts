/**
 * @module chain/stateTransition
 */

export * from "./constants/index.js";
export * from "./util/index.js";
export * from "./metrics.js";

export * as phase0 from "./phase0/index.js";
export * as altair from "./altair/index.js";
export * as bellatrix from "./bellatrix/index.js";
export * as allForks from "./allForks/index.js";

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
} from "./types.js";

// Main state caches
export {createCachedBeaconState, BeaconStateCache} from "./cache/stateCache.js";
export {EpochContext, EpochContextImmutableData, createEmptyEpochContextImmutableData} from "./cache/epochContext.js";
export {EpochProcess, beforeProcessEpoch} from "./cache/epochProcess.js";

// Aux data-structures
export {PubkeyIndexMap, Index2PubkeyCache} from "./cache/pubkeyCache.js";
export {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsZeroed} from "./cache/effectiveBalanceIncrements.js";
