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
export function isExecutionEnabled(state: BeaconStateBellatrix, block: allForks.FullOrBlindedBeaconBlock): boolean {
  if (isMergeTransitionComplete(state)) {
    return true;
  }

  // Throws if not post-bellatrix block. A fork-guard in isExecutionEnabled() prevents this from happening
  const payload = getFullOrBlindedPayload(block);
  // Note: spec says to check all payload is zero-ed. However a state-root cannot be zero for any non-empty payload
  // TODO: Consider comparing with the payload root if this assumption is not correct.
  // return !byteArrayEquals(payload.stateRoot, ZERO_HASH);

  // UPDATE: stateRoot comparision should have been enough with zero hash, but spec tests were failing
  // Revisit this later to fix specs and make this efficient
  return isExecutionPayload(payload)
    ? !ssz.bellatrix.ExecutionPayload.equals(payload, ssz.bellatrix.ExecutionPayload.defaultValue())
    : !ssz.bellatrix.ExecutionPayloadHeader.equals(
        state.latestExecutionPayloadHeader,
        // TODO: Performance
        ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
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

export function getFullOrBlindedPayload(
  block: allForks.FullOrBlindedBeaconBlock
): allForks.FullOrBlindedExecutionPayload {
  if ((block as bellatrix.BlindedBeaconBlock).body.executionPayloadHeader !== undefined) {
    return (block as bellatrix.BlindedBeaconBlock).body.executionPayloadHeader;
  } else if ((block as bellatrix.BeaconBlock).body.executionPayload !== undefined) {
    return (block as bellatrix.BeaconBlock).body.executionPayload;
  } else {
    throw Error("Ǹot allForks.FullOrBlindedBeaconBlock");
  }
}

export function isExecutionPayload(
  payload: allForks.FullOrBlindedExecutionPayload
): payload is bellatrix.ExecutionPayload {
  return (payload as bellatrix.ExecutionPayload).transactions !== undefined;
}

export function isBlindedBeaconBlock(block: allForks.FullOrBlindedBeaconBlock): block is bellatrix.BlindedBeaconBlock {
  return (block as bellatrix.BlindedBeaconBlock).body.executionPayloadHeader !== undefined;
}
