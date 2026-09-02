import {describe, expect, it} from "vitest";
import {ForkName, type ForkPostGloas} from "@lodestar/params";
import type {RootHex} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  type SelectedBidIdentity,
  createExecutionPayloadEnvelopeMaterial,
} from "../../../src/services/executionPayloadEnvelope.js";
import type {BuiltPayload} from "../../../src/services/payloadSource.js";

const builderIndex = 7;
const blockRoot = root(8);

describe("createExecutionPayloadEnvelopeMaterial", () => {
  for (const fork of [ForkName.gloas, ForkName.heze] as const) {
    it(`assembles exact ${fork} stateless envelope material`, () => {
      const payload = createBuiltPayload(fork);
      const selectedBid = bidIdentity(payload);

      const material = createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, payload});

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
  }

  it("rejects retained material for a different slot", () => {
    const payload = createBuiltPayload(ForkName.gloas);
    const selectedBid = {...bidIdentity(payload), slot: 11};

    expectEnvelopeError(() => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, payload}), {
      code: ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
      bidSlot: 11,
      payloadSlot: payload.executionPayload.slotNumber,
    });
  });

  it("rejects retained material for a different parent block hash", () => {
    const payload = createBuiltPayload(ForkName.gloas);
    const selectedBid = {...bidIdentity(payload), parentBlockHash: root(9)};

    expectEnvelopeError(() => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, payload}), {
      code: ExecutionPayloadEnvelopeErrorCode.PARENT_BLOCK_HASH_MISMATCH,
      bidParentBlockHash: selectedBid.parentBlockHash,
      payloadParentBlockHash: toRootHex(payload.executionPayload.parentHash),
    });
  });

  it("rejects retained material for a different execution block hash", () => {
    const payload = createBuiltPayload(ForkName.gloas);
    const selectedBid = {...bidIdentity(payload), blockHash: root(9)};

    expectEnvelopeError(() => createExecutionPayloadEnvelopeMaterial({blockRoot, builderIndex, selectedBid, payload}), {
      code: ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
      bidBlockHash: selectedBid.blockHash,
      payloadBlockHash: toRootHex(payload.executionPayload.blockHash),
    });
  });
});

function createBuiltPayload<F extends ForkPostGloas>(fork: F): BuiltPayload<F> {
  const forkTypes = fork === ForkName.heze ? ssz.heze : ssz.gloas;
  const executionPayload = forkTypes.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = 10;
  executionPayload.parentHash = Buffer.alloc(32, 2);
  executionPayload.blockHash = Buffer.alloc(32, 4);
  const blobsBundle = forkTypes.BlobsBundle.defaultValue();
  blobsBundle.proofs.push(Buffer.alloc(48, 5));
  blobsBundle.blobs.push(Buffer.alloc(0));

  return {
    sourceId: "engine",
    fork,
    executionPayload,
    executionRequests: forkTypes.ExecutionRequests.defaultValue(),
    blobsBundle,
    executionPayloadValue: 1n,
  } as BuiltPayload<F>;
}

function bidIdentity(payload: BuiltPayload): SelectedBidIdentity {
  return {
    slot: payload.executionPayload.slotNumber,
    parentBlockHash: toRootHex(payload.executionPayload.parentHash),
    parentBlockRoot: root(3),
    blockHash: toRootHex(payload.executionPayload.blockHash),
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
