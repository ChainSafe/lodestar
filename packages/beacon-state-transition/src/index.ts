/**
 * @module chain/stateTransition
 */

export * from "./stateTransition.js";
export * from "./constants/index.js";
export * from "./util/index.js";
export * from "./metrics.js";

export * as blockFns from "./block/index.js";
export * as epochFns from "./epoch/index.js";

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

export {
  EffectiveBalanceIncrements,
  getEffectiveBalanceIncrementsZeroed,
  getEffectiveBalanceIncrementsWithLen,
} from "./cache/effectiveBalanceIncrements.js";
