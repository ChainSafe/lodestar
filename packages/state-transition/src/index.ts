export * from "./stateTransition.js";
export * from "./constants/index.js";
export * from "./util/index.js";
export * from "./signatureSets/index.js";
export type {BeaconStateTransitionMetrics} from "./metrics.js";

export type {
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStateCapella,
  CachedBeaconStateDeneb,
  CachedBeaconStateAllForks,
  CachedBeaconStateExecutions,
  // Non-cached states
  BeaconStatePhase0,
  BeaconStateAltair,
  BeaconStateBellatrix,
  BeaconStateCapella,
  BeaconStateDeneb,
  BeaconStateAllForks,
  BeaconStateExecutions,
} from "./types.js";

// Main state caches
export {
  createCachedBeaconState,
  loadUnfinalizedCachedBeaconState,
  type BeaconStateCache,
  isCachedBeaconState,
  isStateBalancesNodesPopulated,
  isStateValidatorsNodesPopulated,
} from "./cache/stateCache.js";
export {
  EpochCache,
  type EpochCacheImmutableData,
  createEmptyEpochCacheImmutableData,
  EpochCacheError,
  EpochCacheErrorCode,
} from "./cache/epochCache.js";
export {type EpochTransitionCache, beforeProcessEpoch} from "./cache/epochTransitionCache.js";

// Aux data-structures
export {PubkeyIndexMap, type Index2PubkeyCache} from "./cache/pubkeyCache.js";

export {
  type EffectiveBalanceIncrements,
  getEffectiveBalanceIncrementsZeroed,
  getEffectiveBalanceIncrementsWithLen,
} from "./cache/effectiveBalanceIncrements.js";

// BeaconChain validation
export {isValidVoluntaryExit} from "./block/processVoluntaryExit.js";
export {isValidBlsToExecutionChange} from "./block/processBlsToExecutionChange.js";
export {assertValidProposerSlashing} from "./block/processProposerSlashing.js";
export {assertValidAttesterSlashing} from "./block/processAttesterSlashing.js";
export {getAttestationParticipationStatus} from "./block/processAttestationsAltair.js";
export {ExecutionPayloadStatus, DataAvailableStatus, type BlockExternalData} from "./block/externalData.js";

// BeaconChain, to prepare new blocks
export {becomesNewEth1Data} from "./block/processEth1Data.js";
// Withdrawals for new blocks
export {getExpectedWithdrawals} from "./block/processWithdrawals.js";
