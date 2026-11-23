import {RootHex, Slot} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum ExecutionPayloadEnvelopeErrorCode {
  BELONG_TO_FINALIZED_BLOCK = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BELONG_TO_FINALIZED_BLOCK",
  BLOCK_ROOT_UNKNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_ROOT_UNKNOWN",
  PARENT_UNKNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_UNKNOWN",
  ENVELOPE_ALREADY_KNOWN = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_ALREADY_KNOWN",
  INVALID_BLOCK = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_BLOCK",
  SLOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_SLOT_MISMATCH",
  PARENT_BEACON_BLOCK_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_BEACON_BLOCK_ROOT_MISMATCH",
  BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_HASH_MISMATCH",
  EXECUTION_REQUESTS_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_EXECUTION_REQUESTS_ROOT_MISMATCH",
  TOO_MANY_TRANSACTIONS = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_TOO_MANY_TRANSACTIONS",
  PAYLOAD_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PAYLOAD_ROOT_MISMATCH",
  PAYLOAD_ENVELOPE_INPUT_MISSING = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PAYLOAD_ENVELOPE_INPUT_MISSING",
}
export type ExecutionPayloadEnvelopeErrorType =
  | {code: ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK; envelopeSlot: Slot; finalizedSlot: Slot}
  | {code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN; blockRoot: RootHex}
  | {code: ExecutionPayloadEnvelopeErrorCode.PARENT_UNKNOWN; parentRoot: RootHex; slot: Slot}
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
      envelopeParentBeaconBlockRoot: RootHex;
      blockParentRoot: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeBlockHash: RootHex;
      bidBlockHash: RootHex | null;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopeRequestsRoot: RootHex;
      bidRequestsRoot: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_TRANSACTIONS;
      slot: Slot;
      root: RootHex;
      transactionCount: number;
      maxTransactionCount: number;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH;
      slot: Slot;
      root: RootHex;
      envelopePayloadRoot: RootHex;
      bidPayloadRoot: RootHex;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING; blockRoot: RootHex};

export class ExecutionPayloadEnvelopeError extends GossipActionError<ExecutionPayloadEnvelopeErrorType> {}
