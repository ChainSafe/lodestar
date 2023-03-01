import {ssz, allForks, capella, deneb} from "@lodestar/types";
import {toHexString, byteArrayEquals} from "@chainsafe/ssz";
import {ForkSeq} from "@lodestar/params";
import {CachedBeaconStateBellatrix, CachedBeaconStateCapella} from "../types.js";
import {getRandaoMix} from "../util/index.js";
import {isExecutionPayload, isMergeTransitionComplete} from "../util/execution.js";
import {BlockExternalData, ExecutionPayloadStatus} from "./externalData.js";

export function processExecutionPayload(
  fork: ForkSeq,
  state: CachedBeaconStateBellatrix | CachedBeaconStateCapella,
  payload: allForks.FullOrBlindedExecutionPayload,
  externalData: BlockExternalData
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
  //
  // Equivalent to `assert executionEngine.notifyNewPayload(payload)`
  if (isExecutionPayload(payload)) {
    switch (externalData.executionPayloadStatus) {
      case ExecutionPayloadStatus.preMerge:
        throw Error("executionPayloadStatus preMerge");
      case ExecutionPayloadStatus.invalid:
        throw Error("Invalid execution payload");
      case ExecutionPayloadStatus.valid:
        break; // ok
    }
  }

  const payloadHeader = isExecutionPayload(payload) ? executionPayloadToPayloadHeader(fork, payload) : payload;

  // TODO Deneb: Types are not happy by default. Since it's a generic allForks type going through ViewDU
  // transformation then into allForks, probably some weird intersection incompatibility happens
  state.latestExecutionPayloadHeader = state.config
    .getExecutionForkTypes(state.slot)
    .ExecutionPayloadHeader.toViewDU(payloadHeader) as typeof state.latestExecutionPayloadHeader;
}

export function executionPayloadToPayloadHeader(
  fork: ForkSeq,
  payload: allForks.ExecutionPayload
): allForks.ExecutionPayloadHeader {
  const transactionsRoot = ssz.bellatrix.Transactions.hashTreeRoot(payload.transactions);

  const bellatrixPayloadFields: allForks.ExecutionPayloadHeader = {
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
    (bellatrixPayloadFields as deneb.ExecutionPayloadHeader).excessDataGas = (payload as
      | deneb.ExecutionPayloadHeader
      | deneb.ExecutionPayload).excessDataGas;
  }

  return bellatrixPayloadFields;
}
