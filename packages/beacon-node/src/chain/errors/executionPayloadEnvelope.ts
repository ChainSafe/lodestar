import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum ExecutionPayloadEnvelopeErrorCode {
  BELONG_TO_FINALIZED_BLOCK = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BELONG_TO_FINALIZED_BLOCK",
  BLOCK_ROOT_UNKNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_ROOT_UNKNOWN",
  PARENT_UNKNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_UNKNOWN",
  UNKNOWN_BLOCK_STATE = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_UNKNOWN_BLOCK_STATE",
  ENVELOPE_ALREADY_KNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_ALREADY_KNOWN",
  INVALID_BLOCK = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_BLOCK",
  SLOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_SLOT_MISMATCH",
  PARENT_BEACON_BLOCK_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_BEACON_BLOCK_ROOT_MISMATCH",
  BUILDER_INDEX_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BUILDER_INDEX_MISMATCH",
  PREV_RANDAO_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PREV_RANDAO_MISMATCH",
  GAS_LIMIT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_GAS_LIMIT_MISMATCH",
  BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_HASH_MISMATCH",
  PARENT_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_HASH_MISMATCH",
  INVALID_TIMESTAMP = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_TIMESTAMP",
  WITHDRAWALS_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_WITHDRAWALS_MISMATCH",
  ZERO_LENGTH_TRANSACTION = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_ZERO_LENGTH_TRANSACTION",
  INVALID_BLOCK_HASH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_BLOCK_HASH",
  EXECUTION_REQUESTS_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_EXECUTION_REQUESTS_ROOT_MISMATCH",
  INVALID_SIGNATURE = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_SIGNATURE",
  PAYLOAD_ENVELOPE_INPUT_MISSING = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PAYLOAD_ENVELOPE_INPUT_MISSING",
}
export type ExecutionPayloadEnvelopeErrorType =
  | {code: ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK; envelopeSlot: Slot; finalizedSlot: Slot}
  | {code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN; blockRoot: RootHex}
  | {code: ExecutionPayloadEnvelopeErrorCode.PARENT_UNKNOWN; parentRoot: RootHex; slot: Slot}
  | {code: ExecutionPayloadEnvelopeErrorCode.UNKNOWN_BLOCK_STATE; blockRoot: RootHex; slot: Slot}
  | {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN;
      blockRoot: RootHex;
      slot: Slot;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK; blockRoot: RootHex}
  | {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeSlot: Slot;
      blockSlot: Slot;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeParentRoot: RootHex;
      blockParentRoot: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.PREV_RANDAO_MISMATCH;
      slot: Slot;
      root: RootHex;
      payloadPrevRandao: string;
      bidPrevRandao: string;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.GAS_LIMIT_MISMATCH;
      slot: Slot;
      root: RootHex;
      payloadGasLimit: number;
      bidGasLimit: bigint;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_HASH_MISMATCH;
      slot: Slot;
      root: RootHex;
      payloadParentHash: RootHex;
      latestBlockHash: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_TIMESTAMP;
      slot: Slot;
      root: RootHex;
      payloadTimestamp: number;
      expectedTimestamp: number;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_MISMATCH;
      slot: Slot;
      root: RootHex;
      payloadWithdrawalsRoot: RootHex;
      expectedWithdrawalsRoot: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeBuilderIndex: BuilderIndex;
      bidBuilderIndex: BuilderIndex | null;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeBlockHash: RootHex;
      bidBlockHash: RootHex | null;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.ZERO_LENGTH_TRANSACTION; slot: Slot; root: RootHex; index: number}
  | {
      code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK_HASH;
      slot: Slot;
      root: RootHex;
      blockHash: RootHex;
      computedBlockHash: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeRequestsRoot: RootHex;
      bidRequestsRoot: RootHex;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE; slot: Slot; root: RootHex}
  | {code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING; blockRoot: RootHex};

export class ExecutionPayloadEnvelopeError extends GossipActionError<ExecutionPayloadEnvelopeErrorType> {}
