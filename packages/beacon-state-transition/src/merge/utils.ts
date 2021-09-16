import {allForks, merge, ssz} from "@chainsafe/lodestar-types";

/**
 * Execution enabled = merge is done.
 * When (A) state has execution data OR (B) block has execution data
 */
export function isExecutionEnabled(state: merge.BeaconState, body: merge.BeaconBlockBody): boolean {
  return (
    isMergeComplete(state) ||
    !ssz.merge.ExecutionPayload.equals(body.executionPayload, ssz.merge.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge block is the SINGLE block that transitions from POW to POS.
 * state has no execution data AND this block has execution data
 */
export function isMergeBlock(state: merge.BeaconState, body: merge.BeaconBlockBody): boolean {
  return (
    !isMergeComplete(state) &&
    !ssz.merge.ExecutionPayload.equals(body.executionPayload, ssz.merge.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge is complete when the state includes execution layer data:
 * state.latestExecutionPayloadHeader NOT EMPTY
 */
export function isMergeComplete(state: merge.BeaconState): boolean {
  return !ssz.merge.ExecutionPayloadHeader.equals(
    state.latestExecutionPayloadHeader,
    ssz.merge.ExecutionPayloadHeader.defaultTreeBacked()
  );
}

/** Type guard for merge.BeaconState */
export function isMergeStateType(state: allForks.BeaconState): state is merge.BeaconState {
  return (state as merge.BeaconState).latestExecutionPayloadHeader !== undefined;
}

/** Type guard for merge.BeaconBlockBody */
export function isMergeBlockBodyType(blockBody: allForks.BeaconBlockBody): blockBody is merge.BeaconBlockBody {
  return (blockBody as merge.BeaconBlockBody).executionPayload !== undefined;
}
