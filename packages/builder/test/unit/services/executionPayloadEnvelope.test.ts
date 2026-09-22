import {describe, expect, it} from "vitest";
import type {RootHex} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  type ExecutionPayloadEnvelopeInput,
  type SelectedBidIdentity,
  createExecutionPayloadEnvelopeMaterial,
} from "../../../src/services/executionPayloadEnvelope.js";
import {type BuiltPayload, PayloadStore} from "../../../src/services/payloadStore.js";

const builderIndex = 7;
const blockRoot = root(8);

describe("createExecutionPayloadEnvelopeMaterial", () => {
  it("assembles stateless envelope material from the payload store", () => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    const store = new PayloadStore();
    store.add({
      slot: selectedBid.slot,
      blockHash: selectedBid.blockHash,
      ...retain(payload, selectedBid.parentBlockRoot),
    });
    const storedPayload = store.get(selectedBid.blockHash);
    expect(storedPayload).not.toBeNull();
    if (storedPayload === null) throw Error("Expected retained payload");

    const material = createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, storedPayload});

    expect(material.envelope).toEqual({
      payload: payload.executionPayload,
      executionRequests: payload.executionRequests,
      builderIndex,
      beaconBlockRoot: fromHex(blockRoot),
      parentBeaconBlockRoot: fromHex(selectedBid.parentBlockRoot),
    });
    expect(material.kzgProofs).toBe(payload.blobsBundle.proofs);
    expect(material.blobs).toBe(payload.blobsBundle.blobs);
  });

  it("rejects retained material for a different slot", () => {
    const payload = createBuiltPayload();
    const selectedBid = {...bidIdentity(payload), slot: 11};
    const storedPayload = retain(payload, selectedBid.parentBlockRoot);

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
        bidSlot: 11,
        payloadSlot: payload.executionPayload.slotNumber,
      }
    );
  });

  it("rejects retained material for a different parent block root", () => {
    const payload = createBuiltPayload();
    const selectedBid = bidIdentity(payload);
    const storedPayload = retain(payload, root(9));

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_ROOT_MISMATCH,
        bidParentBlockRoot: selectedBid.parentBlockRoot,
        storedParentBlockRoot: root(9),
      }
    );
  });

  it("rejects retained material for a different parent block hash", () => {
    const payload = createBuiltPayload();
    const selectedBid = {...bidIdentity(payload), parentBlockHash: root(9)};
    const storedPayload = retain(payload, selectedBid.parentBlockRoot);

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_HASH_MISMATCH,
        bidParentBlockHash: selectedBid.parentBlockHash,
        payloadParentBlockHash: toRootHex(payload.executionPayload.parentHash),
      }
    );
  });

  it("rejects retained material for a different execution block hash", () => {
    const payload = createBuiltPayload();
    const selectedBid = {...bidIdentity(payload), blockHash: root(9)};
    const storedPayload = retain(payload, selectedBid.parentBlockRoot);

    expectEnvelopeError(
      () => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, storedPayload}),
      {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
        bidBlockHash: selectedBid.blockHash,
        payloadBlockHash: toRootHex(payload.executionPayload.blockHash),
      }
    );
  });
});

function createBuiltPayload(): BuiltPayload {
  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = 10;
  executionPayload.parentHash = Buffer.alloc(32, 2);
  executionPayload.blockHash = Buffer.alloc(32, 4);
  const blobsBundle = ssz.gloas.BlobsBundle.defaultValue();
  blobsBundle.proofs.push(Buffer.alloc(48, 5));
  blobsBundle.blobs.push(Buffer.alloc(0));

  return {
    sourceId: "engine",
    executionPayload,
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle,
    executionPayloadValue: 1n,
  };
}

function bidIdentity(payload: BuiltPayload): SelectedBidIdentity {
  return {
    slot: payload.executionPayload.slotNumber,
    parentBlockHash: toRootHex(payload.executionPayload.parentHash),
    parentBlockRoot: root(3),
    blockHash: toRootHex(payload.executionPayload.blockHash),
  };
}

function retain(payload: BuiltPayload, parentBlockRoot: RootHex): ExecutionPayloadEnvelopeInput["storedPayload"] {
  return {parentBlockRoot: fromHex(parentBlockRoot), payload};
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
