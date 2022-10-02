import {ssz, allForks} from "@lodestar/types";
import {toHexString, byteArrayEquals} from "@chainsafe/ssz";
import {CachedBeaconStateBellatrix, CachedBeaconStateCapella} from "../types.js";
import {getRandaoMix} from "../util/index.js";
import {ExecutionEngine} from "../util/executionEngine.js";
import {isExecutionPayload, isMergeTransitionComplete, isCapellaPayload} from "../util/execution.js";

export function processExecutionPayload(
  state: CachedBeaconStateBellatrix | CachedBeaconStateCapella,
  payload: allForks.FullOrBlindedExecutionPayload,
  executionEngine: ExecutionEngine | null
): void {
  // Verify consistency of the parent hash, block number, base fee per gas and gas limit
  // with respect to the previous execution payload header
  if (isMergeTransitionComplete(state)) {
    const {latestExecutionPayloadHeader} = state;
    if (!byteArrayEquals(payload.parentHash, latestExecutionPayloadHeader.blockHash)) {
      throw Error(
        `Invalid execution payload parentHash ${toHexString(payload.parentHash)} latest blockHash ${toHexString(
          latestExecutionPayloadHeader.blockHash
        )}`
      );
    }
  }

  // Verify random
  const expectedRandom = getRandaoMix(state, state.epochCtx.epoch);
  if (!byteArrayEquals(payload.prevRandao, expectedRandom)) {
    throw Error(
      `Invalid execution payload random ${toHexString(payload.prevRandao)} expected=${toHexString(expectedRandom)}`
    );
  }

  // Verify timestamp
  //
  // Note: inlined function in if statement
  // def compute_timestamp_at_slot(state: BeaconState, slot: Slot) -> uint64:
  //   slots_since_genesis = slot - GENESIS_SLOT
  //   return uint64(state.genesis_time + slots_since_genesis * SECONDS_PER_SLOT)
  if (payload.timestamp !== state.genesisTime + state.slot * state.config.SECONDS_PER_SLOT) {
    throw Error(`Invalid timestamp ${payload.timestamp} genesisTime=${state.genesisTime} slot=${state.slot}`);
  }

  // Verify the execution payload is valid
  //
  // if executionEngine is null, executionEngine.onPayload MUST be called after running processBlock to get the
  // correct randao mix. Since executionEngine will be an async call in most cases it is called afterwards to keep
  // the state transition sync
  if (isExecutionPayload(payload) && executionEngine && !executionEngine.notifyNewPayload(payload)) {
    throw Error("Invalid execution payload");
  }

  const transactionsRoot = isExecutionPayload(payload)
    ? ssz.bellatrix.Transactions.hashTreeRoot(payload.transactions)
    : payload.transactionsRoot;
  const bellatrixPayloadFields = {
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

  const withdrawalsRoot = isCapellaPayload(payload)
    ? isExecutionPayload(payload)
      ? ssz.capella.Withdrawals.hashTreeRoot(payload.withdrawals)
      : payload.withdrawalsRoot
    : undefined;

  // Cache execution payload header
  if (withdrawalsRoot !== undefined) {
    (state as CachedBeaconStateCapella).latestExecutionPayloadHeader = ssz.capella.ExecutionPayloadHeader.toViewDU({
      ...bellatrixPayloadFields,
      withdrawalsRoot,
    });
  } else {
    (state as CachedBeaconStateBellatrix).latestExecutionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.toViewDU(
      bellatrixPayloadFields
    );
  }
}
