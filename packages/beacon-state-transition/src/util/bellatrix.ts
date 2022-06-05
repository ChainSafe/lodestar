import {allForks, bellatrix, ssz} from "@chainsafe/lodestar-types";
import {
  BeaconStateBellatrix,
  BeaconStateAllForks,
  CachedBeaconStateBellatrix,
  CachedBeaconStateAllForks,
} from "../types.js";

/**
 * Execution enabled = merge is done.
 * When (A) state has execution data OR (B) block has execution data
 */
export function isExecutionEnabled(state: BeaconStateBellatrix, body: bellatrix.BeaconBlockBody): boolean {
  return (
    isMergeTransitionComplete(state) ||
    !ssz.bellatrix.ExecutionPayload.equals(body.executionPayload, ssz.bellatrix.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge block is the SINGLE block that transitions from POW to POS.
 * state has no execution data AND this block has execution data
 */
export function isMergeTransitionBlock(state: BeaconStateBellatrix, body: bellatrix.BeaconBlockBody): boolean {
  return (
    !isMergeTransitionComplete(state) &&
    !ssz.bellatrix.ExecutionPayload.equals(body.executionPayload, ssz.bellatrix.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge is complete when the state includes execution layer data:
 * state.latestExecutionPayloadHeader NOT EMPTY
 */
export function isMergeTransitionComplete(state: BeaconStateBellatrix): boolean {
  return !ssz.bellatrix.ExecutionPayloadHeader.equals(
    state.latestExecutionPayloadHeader,
    // TODO: Performance
    ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
  );
}

/** Type guard for bellatrix.BeaconState */
export function isBellatrixStateType(state: BeaconStateAllForks): state is BeaconStateBellatrix {
  return (state as BeaconStateBellatrix).latestExecutionPayloadHeader !== undefined;
}

/** Type guard for bellatrix.CachedBeaconState */
export function isBellatrixCachedStateType(state: CachedBeaconStateAllForks): state is CachedBeaconStateBellatrix {
  return (state as CachedBeaconStateBellatrix).latestExecutionPayloadHeader !== undefined;
}

/** Type guard for bellatrix.BeaconBlockBody */
export function isBellatrixBlockBodyType(blockBody: allForks.BeaconBlockBody): blockBody is bellatrix.BeaconBlockBody {
  return (blockBody as bellatrix.BeaconBlockBody).executionPayload !== undefined;
}
