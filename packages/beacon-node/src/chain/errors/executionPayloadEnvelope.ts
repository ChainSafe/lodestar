import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum ExecutionPayloadEnvelopeErrorCode {
  BELONG_TO_FINALIZED_BLOCK = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BELONG_TO_FINALIZED_BLOCK",
  BLOCK_ROOT_UNKNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_ROOT_UNKNOWN",
  ENVELOPE_ALREADY_KNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_ALREADY_KNOWN",
  INVALID_BLOCK = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_BLOCK",
  SLOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_SLOT_MISMATCH",
  BUILDER_INDEX_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BUILDER_INDEX_MISMATCH",
  BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_HASH_MISMATCH",
  INVALID_SIGNATURE = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_SIGNATURE",
  CACHE_FAIL = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_CACHE_FAIL",
}
export type ExecutionPayloadEnvelopeErrorType =
  | {code: ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK; envelopeSlot: Slot; finalizedSlot: Slot}
  | {code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN; blockRoot: RootHex}
  | {
      code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN;
      blockRoot: RootHex;
      slot: Slot;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK; blockRoot: RootHex}
  | {code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH; envelopeSlot: Slot; blockSlot: Slot}
  | {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH;
      envelopeBuilderIndex: BuilderIndex;
      bidBuilderIndex: BuilderIndex;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH; envelopeBlockHash: RootHex; bidBlockHash: RootHex}
  | {code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE}
  | {code: ExecutionPayloadEnvelopeErrorCode.CACHE_FAIL; blockRoot: RootHex};

export class ExecutionPayloadEnvelopeError extends GossipActionError<ExecutionPayloadEnvelopeErrorType> {}
