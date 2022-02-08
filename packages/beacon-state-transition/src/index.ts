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
export {CachedBeaconState, createCachedBeaconState} from "./allForks/util/cachedBeaconState";

export {
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStateAllForks,
  CachedBeaconStateAnyFork,
} from "./types";

export {
  EffectiveBalanceIncrements,
  getEffectiveBalanceIncrementsZeroed,
} from "./allForks/util/effectiveBalanceIncrements";
