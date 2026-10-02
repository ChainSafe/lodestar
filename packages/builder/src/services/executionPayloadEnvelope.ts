import type {BuilderIndex, RootHex, Slot, deneb, gloas} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {LodestarError, byteArrayEquals, fromHex, toRootHex} from "@lodestar/utils";
import type {StoredPayload} from "./payloadStore.js";

export type ExecutionPayloadEnvelopeInput = {
  blockRoot: RootHex;
  builderIndex: BuilderIndex;
  selectedBid: gloas.ExecutionPayloadBid;
  storedPayload: StoredPayload;
};

export type ExecutionPayloadEnvelopeContents = {
  envelope: gloas.ExecutionPayloadEnvelope;
  kzgProofs: deneb.KZGProofs;
  blobs: deneb.Blobs;
};

export enum ExecutionPayloadEnvelopeErrorCode {
  SLOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_SLOT_MISMATCH",
  PARENT_BLOCK_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_BLOCK_ROOT_MISMATCH",
  PARENT_BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_PARENT_BLOCK_HASH_MISMATCH",
  BLOCK_HASH_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_HASH_MISMATCH",
  BUILDER_INDEX_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BUILDER_INDEX_MISMATCH",
  BLOB_KZG_COMMITMENTS_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOB_KZG_COMMITMENTS_MISMATCH",
  EXECUTION_REQUESTS_ROOT_MISMATCH = "EXECUTION_PAYLOAD_ENVELOPE_ERROR_EXECUTION_REQUESTS_ROOT_MISMATCH",
}

export type ExecutionPayloadEnvelopeErrorType =
  | {
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH;
      builderIndex: BuilderIndex;
      bidBuilderIndex: BuilderIndex;
    }
  | {code: ExecutionPayloadEnvelopeErrorCode.BLOB_KZG_COMMITMENTS_MISMATCH}
  | {
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH;
      bidExecutionRequestsRoot: RootHex;
      payloadExecutionRequestsRoot: RootHex;
    }
  | {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_ROOT_MISMATCH;
      bidParentBlockRoot: RootHex;
      storedParentBlockRoot: RootHex;
    }
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

/** The caller must have matched the selected bid to its local ledger record. */
export function createExecutionPayloadEnvelopeContents({
  blockRoot,
  builderIndex,
  selectedBid,
  storedPayload,
}: ExecutionPayloadEnvelopeInput): ExecutionPayloadEnvelopeContents {
  if (builderIndex !== selectedBid.builderIndex) {
    throw new ExecutionPayloadEnvelopeError({
      code: ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH,
      builderIndex,
      bidBuilderIndex: selectedBid.builderIndex,
    });
  }

  const bidParentBlockRoot = toRootHex(selectedBid.parentBlockRoot);
  const storedParentBlockRoot = toRootHex(storedPayload.parentBlockRoot);
  if (storedParentBlockRoot !== bidParentBlockRoot) {
    throw new ExecutionPayloadEnvelopeError(
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_ROOT_MISMATCH,
        bidParentBlockRoot,
        storedParentBlockRoot,
      },
      `Selected bid beacon parent does not match retained payload bidParentBlockRoot=${bidParentBlockRoot} storedParentBlockRoot=${storedParentBlockRoot}`
    );
  }

  const {payload} = storedPayload;
  const payloadSlot = payload.executionPayload.slotNumber;
  if (payloadSlot !== selectedBid.slot) {
    throw new ExecutionPayloadEnvelopeError(
      {code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH, bidSlot: selectedBid.slot, payloadSlot},
      `Selected bid slot does not match payload slot bidSlot=${selectedBid.slot} payloadSlot=${payloadSlot}`
    );
  }

  const payloadParentBlockHash = toRootHex(payload.executionPayload.parentHash);
  const bidParentBlockHash = toRootHex(selectedBid.parentBlockHash);
  if (payloadParentBlockHash !== bidParentBlockHash) {
    throw new ExecutionPayloadEnvelopeError(
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_HASH_MISMATCH,
        bidParentBlockHash,
        payloadParentBlockHash,
      },
      `Selected bid parent does not match payload parent bidParentBlockHash=${bidParentBlockHash} payloadParentBlockHash=${payloadParentBlockHash}`
    );
  }

  const payloadBlockHash = toRootHex(payload.executionPayload.blockHash);
  const bidBlockHash = toRootHex(selectedBid.blockHash);
  if (payloadBlockHash !== bidBlockHash) {
    throw new ExecutionPayloadEnvelopeError(
      {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
        bidBlockHash,
        payloadBlockHash,
      },
      `Selected bid block hash does not match payload bidBlockHash=${bidBlockHash} payloadBlockHash=${payloadBlockHash}`
    );
  }

  if (
    !ssz.gloas.ExecutionPayloadBid.fields.blobKzgCommitments.equals(
      selectedBid.blobKzgCommitments,
      payload.blobsBundle.commitments
    )
  ) {
    throw new ExecutionPayloadEnvelopeError({code: ExecutionPayloadEnvelopeErrorCode.BLOB_KZG_COMMITMENTS_MISMATCH});
  }

  const executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  if (!byteArrayEquals(executionRequestsRoot, selectedBid.executionRequestsRoot)) {
    throw new ExecutionPayloadEnvelopeError({
      code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
      bidExecutionRequestsRoot: toRootHex(selectedBid.executionRequestsRoot),
      payloadExecutionRequestsRoot: toRootHex(executionRequestsRoot),
    });
  }

  return {
    envelope: {
      payload: payload.executionPayload,
      executionRequests: payload.executionRequests,
      builderIndex,
      beaconBlockRoot: fromHex(blockRoot),
      parentBeaconBlockRoot: selectedBid.parentBlockRoot,
    },
    kzgProofs: payload.blobsBundle.proofs,
    blobs: payload.blobsBundle.blobs,
  };
}
