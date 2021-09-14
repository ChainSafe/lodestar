import {GAS_LIMIT_DENOMINATOR, MIN_GAS_LIMIT} from "@chainsafe/lodestar-params";
import {merge, ssz} from "@chainsafe/lodestar-types";
import {byteArrayEquals, List} from "@chainsafe/ssz";
import {CachedBeaconState} from "../../allForks";
import {getCurrentEpoch, getRandaoMix} from "../../util";
import {ExecutionEngine} from "../executionEngine";

export function isExecutionEnabled(state: merge.BeaconState, body: merge.BeaconBlockBody): boolean {
  return isMergeBlock(state, body) || isMergeComplete(state);
}

function isMergeBlock(state: merge.BeaconState, body: merge.BeaconBlockBody): boolean {
  return (
    !isMergeComplete(state) &&
    !ssz.merge.ExecutionPayload.equals(body.executionPayload, ssz.merge.ExecutionPayload.defaultValue())
  );
}

function isMergeComplete(state: merge.BeaconState): boolean {
  return !ssz.merge.ExecutionPayloadHeader.equals(
    state.latestExecutionPayloadHeader,
    ssz.merge.ExecutionPayloadHeader.defaultValue()
  );
}

function isValidGasLimit(payload: merge.ExecutionPayload, parent: merge.ExecutionPayloadHeader): boolean {
  const parentGasLimit = parent.gasLimit;

  // Check if the payload used too much gas
  if (payload.gasUsed > payload.gasLimit) {
    return false;
  }

  // Check if the payload changed the gas limit too much
  if (payload.gasLimit >= parentGasLimit + Math.floor(parentGasLimit / GAS_LIMIT_DENOMINATOR)) {
    return false;
  }
  if (payload.gasLimit <= parentGasLimit - Math.floor(parentGasLimit / GAS_LIMIT_DENOMINATOR)) {
    return false;
  }

  // Check if the gas limit is at least the minimum gas limit
  if (payload.gasLimit < MIN_GAS_LIMIT) {
    return false;
  }

  return true;
}

export function processExecutionPayload(
  state: CachedBeaconState<merge.BeaconState>,
  payload: merge.ExecutionPayload,
  executionEngine: ExecutionEngine | null
): void {
  // Verify consistency of the parent hash, block number, random, base fee per gas and gas limit
  if (isMergeComplete(state)) {
    const {latestExecutionPayloadHeader} = state;
    if (!byteArrayEquals(payload.parentHash as Uint8Array, latestExecutionPayloadHeader.blockHash as Uint8Array)) {
      throw Error("Inconsistent execution payload parentHash");
    }
    if (payload.blockNumber !== latestExecutionPayloadHeader.blockNumber + 1) {
      throw Error("Inconsistent execution payload blockNumber");
    }
    if (!byteArrayEquals(payload.random as Uint8Array, getRandaoMix(state, getCurrentEpoch(state)) as Uint8Array)) {
      throw Error("Inconsistent execution payload random");
    }
    if (!isValidGasLimit(payload, latestExecutionPayloadHeader)) {
      throw Error("Inconsistent execution payload gas limit");
    }
  }

  // Verify timestamp
  //
  // Note: inlined function in if statement
  // def compute_timestamp_at_slot(state: BeaconState, slot: Slot) -> uint64:
  //   slots_since_genesis = slot - GENESIS_SLOT
  //   return uint64(state.genesis_time + slots_since_genesis * SECONDS_PER_SLOT)
  if (payload.timestamp !== state.genesisTime + state.slot * state.config.SECONDS_PER_SLOT) {
    throw Error("Invalid timestamp");
  }

  // Verify the execution payload is valid
  //
  // if executionEngine is null, executionEngine.onPayload MUST be called after running processBlock to get the
  // correct randao mix. Since executionEngine will be an async call in most cases it is called afterwards to keep
  // the state transition sync

  if (executionEngine && executionEngine.onPayload(payload)) {
    throw Error("Invalid execution payload");
  }

  // Cache execution payload header
  state.latestExecutionPayloadHeader = {
    parentHash: payload.parentHash,
    coinbase: payload.coinbase,
    stateRoot: payload.stateRoot,
    receiptRoot: payload.receiptRoot,
    logsBloom: payload.logsBloom,
    random: payload.random,
    blockNumber: payload.blockNumber,
    gasLimit: payload.gasLimit,
    gasUsed: payload.gasUsed,
    timestamp: payload.timestamp,
    baseFeePerGas: payload.baseFeePerGas,
    blockHash: payload.blockHash,
    transactionsRoot: ssz.merge.Transactions.hashTreeRoot(payload.transactions as List<Uint8Array>),
  };
}
