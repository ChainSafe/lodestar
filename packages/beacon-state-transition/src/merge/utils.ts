import {merge, ssz} from "@chainsafe/lodestar-types";

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
