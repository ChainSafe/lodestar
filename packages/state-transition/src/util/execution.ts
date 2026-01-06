import {ForkName, ForkPostBellatrix, ForkPreGloas, ForkSeq} from "@lodestar/params";
import {
  BeaconBlock,
  BeaconBlockBody,
  BlindedBeaconBlock,
  BlindedBeaconBlockBody,
  ExecutionPayload,
  ExecutionPayloadHeader,
  bellatrix,
  capella,
  deneb,
  isBlindedBeaconBlockBody,
  isExecutionPayload,
  ssz,
} from "@lodestar/types";
import {
  BeaconStateAllForks,
  BeaconStateBellatrix,
  BeaconStateCapella,
  BeaconStateExecutions,
  CachedBeaconStateAllForks,
  CachedBeaconStateExecutions,
} from "../types.js";

/**
 * Execution enabled = merge is done.
 * When (A) state has execution data OR (B) block has execution data
 */
export function isExecutionEnabled(state: BeaconStateExecutions, block: BeaconBlock | BlindedBeaconBlock): boolean {
  if (isMergeTransitionComplete(state)) {
    return true;
  }

  // Throws if not post-bellatrix block. A fork-guard before isExecutionEnabled() prevents this from happening
  const payload = getFullOrBlindedPayload(block);

  return isExecutionPayload(payload)
    ? !ssz.bellatrix.ExecutionPayload.equals(payload, ssz.bellatrix.ExecutionPayload.defaultValue())
    : !ssz.bellatrix.ExecutionPayloadHeader.equals(
        state.latestExecutionPayloadHeader,
        ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
      );
}

/**
 * Merge is complete when the state includes execution layer data:
 * state.latestExecutionPayloadHeader NOT EMPTY or state is post-capella
 */
export function isMergeTransitionComplete(state: BeaconStateExecutions): boolean {
  if (isCapellaStateType(state)) {
    // All networks have completed the merge transition before capella
    return true;
  }

  return !ssz.bellatrix.ExecutionPayloadHeader.equals(
    (state as BeaconStateBellatrix).latestExecutionPayloadHeader,
    ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
  );
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

/** Type guard for ExecutionBlockBody */
export function isExecutionBlockBodyType(
  blockBody: BeaconBlockBody
): blockBody is BeaconBlockBody<ForkPostBellatrix & ForkPreGloas> {
  return (blockBody as BeaconBlockBody<ForkPostBellatrix & ForkPreGloas>).executionPayload !== undefined;
}

export function getFullOrBlindedPayload(block: BeaconBlock): ExecutionPayload | ExecutionPayloadHeader {
  return getFullOrBlindedPayloadFromBody(block.body);
}

export function getFullOrBlindedPayloadFromBody(
  body: BeaconBlockBody | BlindedBeaconBlockBody
): ExecutionPayload | ExecutionPayloadHeader {
  if (isBlindedBeaconBlockBody(body)) {
    return body.executionPayloadHeader;
  }

  if ((body as bellatrix.BeaconBlockBody).executionPayload !== undefined) {
    return (body as bellatrix.BeaconBlockBody).executionPayload;
  }

  throw Error("Not full or blinded beacon block");
}

export function isCapellaPayload(
  payload: ExecutionPayload | ExecutionPayloadHeader
): payload is ExecutionPayload<ForkName.capella> | ExecutionPayloadHeader<ForkName.capella> {
  return (
    (payload as ExecutionPayload<ForkName.capella>).withdrawals !== undefined ||
    (payload as ExecutionPayloadHeader<ForkName.capella>).withdrawalsRoot !== undefined
  );
}

export function isCapellaPayloadHeader(
  payload: capella.FullOrBlindedExecutionPayload
): payload is capella.ExecutionPayloadHeader {
  return (payload as capella.ExecutionPayloadHeader).withdrawalsRoot !== undefined;
}

export function executionPayloadToPayloadHeader(fork: ForkSeq, payload: ExecutionPayload): ExecutionPayloadHeader {
  const transactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(payload.transactions);

  const bellatrixPayloadFields: ExecutionPayloadHeader = {
    parentHash: payload.parentHash,
    feeRecipient: payload.feeRecipient,
    stateRoot: payload.stateRoot,
    receiptsRoot: payload.receiptsRoot,
    logsBloom: payload.logsBloom,
    prevRandao: payload.prevRandao,
    blockNumber: payload.blockNumber,
    gasLimit: payload.gasLimit,
    gasUsed: payload.gasUsed,
    timestamp: payload.timestamp,
    extraData: payload.extraData,
    baseFeePerGas: payload.baseFeePerGas,
    blockHash: payload.blockHash,
    transactionsRoot,
  };

  if (fork >= ForkSeq.capella) {
    (bellatrixPayloadFields as capella.ExecutionPayloadHeader).withdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(
      (payload as capella.ExecutionPayload).withdrawals
    );
  }

  if (fork >= ForkSeq.deneb) {
    // https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#process_execution_payload
    (bellatrixPayloadFields as deneb.ExecutionPayloadHeader).blobGasUsed = (
      payload as deneb.ExecutionPayloadHeader | deneb.ExecutionPayload
    ).blobGasUsed;
    (bellatrixPayloadFields as deneb.ExecutionPayloadHeader).excessBlobGas = (
      payload as deneb.ExecutionPayloadHeader | deneb.ExecutionPayload
    ).excessBlobGas;
  }

  // No change in Electra

  return bellatrixPayloadFields;
}
