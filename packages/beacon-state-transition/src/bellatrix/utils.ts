import {allForks, bellatrix, ssz} from "@chainsafe/lodestar-types";

/**
 * Execution enabled = merge is done.
 * When (A) state has execution data OR (B) block has execution data
 */
export function isExecutionEnabled(state: bellatrix.BeaconState, body: bellatrix.BeaconBlockBody): boolean {
  return (
    isMergeTransitionComplete(state) ||
    !ssz.bellatrix.ExecutionPayload.equals(body.executionPayload, ssz.bellatrix.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge block is the SINGLE block that transitions from POW to POS.
 * state has no execution data AND this block has execution data
 */
export function isMergeTransitionBlock(state: bellatrix.BeaconState, body: bellatrix.BeaconBlockBody): boolean {
  return (
    !isMergeTransitionComplete(state) &&
    !ssz.bellatrix.ExecutionPayload.equals(body.executionPayload, ssz.bellatrix.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge is complete when the state includes execution layer data:
 * state.latestExecutionPayloadHeader NOT EMPTY
 */
export function isMergeTransitionComplete(state: bellatrix.BeaconState): boolean {
  return !ssz.bellatrix.ExecutionPayloadHeader.equals(
    state.latestExecutionPayloadHeader,
    ssz.bellatrix.ExecutionPayloadHeader.defaultTreeBacked()
  );
}

/** Type guard for bellatrix.BeaconState */
export function isBellatrixStateType(state: allForks.BeaconState): state is bellatrix.BeaconState {
  return (state as bellatrix.BeaconState).latestExecutionPayloadHeader !== undefined;
}

/** Type guard for bellatrix.BeaconBlockBody */
export function isBellatrixBlockBodyType(blockBody: allForks.BeaconBlockBody): blockBody is bellatrix.BeaconBlockBody {
  return (blockBody as bellatrix.BeaconBlockBody).executionPayload !== undefined;
}
