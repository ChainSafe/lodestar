import {describe, expect, it} from "vitest";
import type {Root, RootHex, gloas} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  createExecutionPayloadEnvelopeContents,
} from "../../../src/services/executionPayloadEnvelope.js";
import {type BuiltPayload, PayloadStore, type StoredPayload} from "../../../src/services/payloadStore.js";

const builderIndex = 7;
const blockRoot = root(8);

describe("createExecutionPayloadEnvelopeContents", () => {
  it("assembles the envelope contents from the retained payload", () => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    const store = new PayloadStore();
    store.add(retain(payload, selectedBid.parentBlockRoot));
    const storedPayload = store.get(toRootHex(selectedBid.blockHash));
    expect(storedPayload).not.toBeNull();
    if (storedPayload === null) throw Error("Expected retained payload");

    const contents = createExecutionPayloadEnvelopeContents({blockRoot, builderIndex, selectedBid, storedPayload});

    expect(contents.envelope).toEqual({
      payload: payload.executionPayload,
      executionRequests: payload.executionRequests,
      builderIndex,
      beaconBlockRoot: fromHex(blockRoot),
      parentBeaconBlockRoot: selectedBid.parentBlockRoot,
    });
    expect(contents.kzgProofs).toBe(payload.blobsBundle.proofs);
    expect(contents.blobs).toBe(payload.blobsBundle.blobs);
  });

  it("rejects a retained payload for a different slot", () => {
    const payload = createBuiltPayload();
    const selectedBid = {...bidIdentity(payload), slot: 11};
    const storedPayload = retain(payload, selectedBid.parentBlockRoot);

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeContents({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
        bidSlot: 11,
        payloadSlot: payload.executionPayload.slotNumber,
      }
    );
  });

  it("rejects a retained payload for a different parent block root", () => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    const storedPayload = retain(payload, fromHex(root(9)));

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeContents({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_ROOT_MISMATCH,
        bidParentBlockRoot: toRootHex(selectedBid.parentBlockRoot),
        storedParentBlockRoot: root(9),
      }
    );
  });

  it("rejects a retained payload for a different parent block hash", () => {
    const payload = createBuiltPayload();
    const selectedBid = {...bidIdentity(payload), parentBlockHash: fromHex(root(9))};
    const storedPayload = retain(payload, selectedBid.parentBlockRoot);

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeContents({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_HASH_MISMATCH,
        bidParentBlockHash: toRootHex(selectedBid.parentBlockHash),
        payloadParentBlockHash: toRootHex(payload.executionPayload.parentHash),
      }
    );
  });

  it("rejects a retained payload for a different execution block hash", () => {
    const payload = createBuiltPayload();
    const selectedBid = {...bidIdentity(payload), blockHash: fromHex(root(9))};
    const storedPayload = retain(payload, selectedBid.parentBlockRoot);

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeContents({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
        bidBlockHash: toRootHex(selectedBid.blockHash),
        payloadBlockHash: toRootHex(payload.executionPayload.blockHash),
      }
    );
  });

  it.each([
    ["builderIndex", ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH],
    ["blobKzgCommitments", ExecutionPayloadEnvelopeErrorCode.BLOB_KZG_COMMITMENTS_MISMATCH],
    ["executionRequestsRoot", ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH],
  ] as const)("rejects a selected bid with a different %s", (field, code) => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    if (field === "builderIndex") selectedBid.builderIndex++;
    if (field === "blobKzgCommitments") selectedBid.blobKzgCommitments = [Buffer.alloc(48, 9)];
    if (field === "executionRequestsRoot") selectedBid.executionRequestsRoot = Buffer.alloc(32, 9);

    expect(() =>
      createExecutionPayloadEnvelopeContents({
        blockRoot,
        builderIndex,
        selectedBid,
        storedPayload: retain(payload, selectedBid.parentBlockRoot),
      })
    ).toThrow(expect.objectContaining({type: expect.objectContaining({code})}));
  });

  it("rejects execution requests changed after the bid was constructed", () => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    payload.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());

    expect(() =>
      createExecutionPayloadEnvelopeContents({
        blockRoot,
        builderIndex,
        selectedBid,
        storedPayload: retain(payload, selectedBid.parentBlockRoot),
      })
    ).toThrow(
      expect.objectContaining({
        type: expect.objectContaining({
          code: ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
        }),
      })
    );
  });

  it.each(["count", "order", "value"])("rejects changed commitment %s", (change) => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    if (change === "count") payload.blobsBundle.commitments.pop();
    if (change === "order") payload.blobsBundle.commitments.reverse();
    if (change === "value") payload.blobsBundle.commitments[0][0]++;

    expect(() =>
      createExecutionPayloadEnvelopeContents({
        blockRoot,
        builderIndex,
        selectedBid,
        storedPayload: retain(payload, selectedBid.parentBlockRoot),
      })
    ).toThrow(
      expect.objectContaining({
        type: {
          code: ExecutionPayloadEnvelopeErrorCode.BLOB_KZG_COMMITMENTS_MISMATCH,
        },
      })
    );
  });
});

function createBuiltPayload(): BuiltPayload {
  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = 10;
  executionPayload.parentHash = Buffer.alloc(32, 2);
  executionPayload.blockHash = Buffer.alloc(32, 4);
  const blobsBundle = ssz.gloas.BlobsBundle.defaultValue();
  blobsBundle.commitments.push(Buffer.alloc(48, 6), Buffer.alloc(48, 7));
  blobsBundle.proofs.push(Buffer.alloc(48, 5), Buffer.alloc(48, 8));
  blobsBundle.blobs.push(Buffer.alloc(0), Buffer.alloc(0));

  return {
    sourceId: "engine",
    executionPayload,
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle,
    executionPayloadValue: 1n,
  };
}

function bidIdentity(payload: BuiltPayload): gloas.ExecutionPayloadBid {
  return {
    ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
    slot: payload.executionPayload.slotNumber,
    parentBlockHash: Uint8Array.from(payload.executionPayload.parentHash),
    parentBlockRoot: fromHex(root(3)),
    blockHash: Uint8Array.from(payload.executionPayload.blockHash),
    builderIndex,
    blobKzgCommitments: payload.blobsBundle.commitments.map((commitment) => Uint8Array.from(commitment)),
    executionRequestsRoot: ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests),
  };
}

function retain(payload: BuiltPayload, parentBlockRoot: Root): StoredPayload {
  return {
    slot: payload.executionPayload.slotNumber,
    parentBlockRoot,
    blockHash: toRootHex(payload.executionPayload.blockHash),
    payload,
  };
}

function root(byte: number): RootHex {
  return toRootHex(Buffer.alloc(32, byte));
}

function expectEnvelopeError(fn: () => unknown, type: ExecutionPayloadEnvelopeError["type"]): void {
  expect(fn).toThrowError(ExecutionPayloadEnvelopeError);
  try {
    fn();
    throw Error("Expected ExecutionPayloadEnvelopeError");
  } catch (error) {
    if (!(error instanceof ExecutionPayloadEnvelopeError)) {
      throw error;
    }
    expect(error.type).toEqual(type);
  }
}
