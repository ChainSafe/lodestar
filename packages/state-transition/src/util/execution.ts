import {allForks, bellatrix, capella, isBlindedBeaconBlock, ssz} from "@lodestar/types";
import {
  BeaconStateBellatrix,
  BeaconStateCapella,
  BeaconStateAllForks,
  BeaconStateExecutions,
  CachedBeaconStateAllForks,
  CachedBeaconStateExecutions,
} from "../types.js";

/**
 * Execution enabled = merge is done.
 * When (A) state has execution data OR (B) block has execution data
 */
export function isExecutionEnabled(state: BeaconStateExecutions, block: allForks.FullOrBlindedBeaconBlock): boolean {
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
export function isMergeTransitionBlock(state: BeaconStateExecutions, body: bellatrix.BeaconBlockBody): boolean {
  return (
    !isMergeTransitionComplete(state) &&
    !ssz.bellatrix.ExecutionPayload.equals(body.executionPayload, ssz.bellatrix.ExecutionPayload.defaultValue())
  );
}

/**
 * Merge is complete when the state includes execution layer data:
 * state.latestExecutionPayloadHeader NOT EMPTY
 */
export function isMergeTransitionComplete(state: BeaconStateExecutions): boolean {
  if (!isCapellaStateType(state)) {
    return !ssz.bellatrix.ExecutionPayloadHeader.equals(
      (state as BeaconStateBellatrix).latestExecutionPayloadHeader,
      // TODO: Performance
      ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
    );
  } else {
    return !ssz.capella.ExecutionPayloadHeader.equals(
      (state as BeaconStateCapella).latestExecutionPayloadHeader,
      // TODO: Performance
      ssz.capella.ExecutionPayloadHeader.defaultValue()
    );
  }
}

/** Type guard for bellatrix.BeaconState */
export function isExecutionStateType(state: BeaconStateAllForks): state is BeaconStateExecutions {
  return (state as BeaconStateExecutions).latestExecutionPayloadHeader !== undefined;
}

/** Type guard for capella.BeaconState */
export function isCapellaStateType(state: BeaconStateAllForks): state is BeaconStateCapella {
  return (
    (state as BeaconStateCapella).latestExecutionPayloadHeader !== undefined &&
    (state as BeaconStateCapella).latestExecutionPayloadHeader.withdrawalsRoot !== undefined
  );
}

/** Type guard for bellatrix.CachedBeaconState */
export function isExecutionCachedStateType(state: CachedBeaconStateAllForks): state is CachedBeaconStateExecutions {
  return (state as CachedBeaconStateExecutions).latestExecutionPayloadHeader !== undefined;
}

/** Type guard for allForks.ExecutionBlockBody */
export function isExecutionBlockBodyType(
  blockBody: allForks.BeaconBlockBody
): blockBody is allForks.ExecutionBlockBody {
  return (blockBody as allForks.ExecutionBlockBody).executionPayload !== undefined;
}

export function getFullOrBlindedPayload(
  block: allForks.FullOrBlindedBeaconBlock
): allForks.FullOrBlindedExecutionPayload {
  if (isBlindedBeaconBlock(block)) {
    return block.body.executionPayloadHeader;
  } else if ((block as bellatrix.BeaconBlock).body.executionPayload !== undefined) {
    return (block as bellatrix.BeaconBlock).body.executionPayload;
  } else {
    throw Error("Ǹot allForks.FullOrBlindedBeaconBlock");
  }
}

export function isExecutionPayload(
  payload: allForks.FullOrBlindedExecutionPayload
): payload is allForks.ExecutionPayload {
  return (payload as allForks.ExecutionPayload).transactions !== undefined;
}

export function isCapellaPayload(
  payload: allForks.FullOrBlindedExecutionPayload
): payload is capella.ExecutionPayload | capella.ExecutionPayloadHeader {
  return (
    (payload as capella.ExecutionPayload).withdrawals !== undefined ||
    (payload as capella.ExecutionPayloadHeader).withdrawalsRoot !== undefined
  );
}
