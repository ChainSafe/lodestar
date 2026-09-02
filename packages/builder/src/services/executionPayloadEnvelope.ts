import type {BuilderIndex, RootHex, Slot, gloas} from "@lodestar/types";
import {LodestarError, fromHex, toRootHex} from "@lodestar/utils";
import type {BuiltPayload} from "./payloadSource.js";

export type SelectedBidIdentity = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
};

export type ExecutionPayloadEnvelopeInput = {
  blockRoot: RootHex;
  builderIndex: BuilderIndex;
  selectedBid: SelectedBidIdentity;
  payload: BuiltPayload;
};

export type ExecutionPayloadEnvelopeMaterial = {
  envelope: gloas.ExecutionPayloadEnvelope;
  kzgProofs: BuiltPayload["blobsBundle"]["proofs"];
  blobs: BuiltPayload["blobsBundle"]["blobs"];
};

export enum ExecutionPayloadEnvelopeErrorCode {
  SLOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_SLOT_MISMATCH",
  PARENT_BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_BLOCK_HASH_MISMATCH",
  BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_HASH_MISMATCH",
}

export type ExecutionPayloadEnvelopeErrorType =
  | {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH;
      bidSlot: Slot;
      payloadSlot: Slot;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_HASH_MISMATCH;
      bidParentBlockHash: RootHex;
      payloadParentBlockHash: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH;
      bidBlockHash: RootHex;
      payloadBlockHash: RootHex;
    };

export class ExecutionPayloadEnvelopeError extends LodestarError<ExecutionPayloadEnvelopeErrorType> {}

export function createExecutionPayloadEnvelopeMaterial({
  blockRoot,
  builderIndex,
  selectedBid,
  payload,
}: ExecutionPayloadEnvelopeInput): ExecutionPayloadEnvelopeMaterial {
  const payloadSlot = payload.executionPayload.slotNumber;
  if (payloadSlot !== selectedBid.slot) {
    throw new ExecutionPayloadEnvelopeError(
      {code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH, bidSlot: selectedBid.slot, payloadSlot},
      `Selected bid slot does not match payload slot bidSlot=${selectedBid.slot} payloadSlot=${payloadSlot}`
    );
  }

  const payloadParentBlockHash = toRootHex(payload.executionPayload.parentHash);
  if (payloadParentBlockHash !== selectedBid.parentBlockHash) {
    throw new ExecutionPayloadEnvelopeError(
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_HASH_MISMATCH,
        bidParentBlockHash: selectedBid.parentBlockHash,
        payloadParentBlockHash,
      },
      `Selected bid parent does not match payload parent bidParentBlockHash=${selectedBid.parentBlockHash} payloadParentBlockHash=${payloadParentBlockHash}`
    );
  }

  const payloadBlockHash = toRootHex(payload.executionPayload.blockHash);
  if (payloadBlockHash !== selectedBid.blockHash) {
    throw new ExecutionPayloadEnvelopeError(
      {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
        bidBlockHash: selectedBid.blockHash,
        payloadBlockHash,
      },
      `Selected bid block hash does not match payload bidBlockHash=${selectedBid.blockHash} payloadBlockHash=${payloadBlockHash}`
    );
  }

  return {
    envelope: {
      payload: payload.executionPayload,
      executionRequests: payload.executionRequests,
      builderIndex,
      beaconBlockRoot: fromHex(blockRoot),
      parentBeaconBlockRoot: fromHex(selectedBid.parentBlockRoot),
    },
    kzgProofs: payload.blobsBundle.proofs,
    blobs: payload.blobsBundle.blobs,
  };
}
