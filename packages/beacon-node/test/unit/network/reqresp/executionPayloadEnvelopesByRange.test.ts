import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {onExecutionPayloadEnvelopesByRange} from "../../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRange.js";

function rootWithByte(n: number): Uint8Array {
  const root = new Uint8Array(32);
  root[31] = n;
  return root;
}

describe("beacon-node / network / reqresp / handlers / executionPayloadEnvelopesByRange", () => {
  it("serves envelopes from finalized archive and non-finalized cache", async () => {
    const finalizedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    finalizedEnvelope.message.slot = 64;
    finalizedEnvelope.message.beaconBlockRoot = rootWithByte(64);

    const hotEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    hotEnvelope.message.slot = 65;
    hotEnvelope.message.beaconBlockRoot = rootWithByte(65);

    const finalizedBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(finalizedEnvelope);
    const hotBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(hotEnvelope);

    const archivedBySlot = new Map<number, Uint8Array>([[64, finalizedBytes]]);

    const chain = {
      config: {
        SLOTS_PER_EPOCH: 32,
        MAX_REQUEST_BLOCKS: 1024,
        MAX_REQUEST_BLOCKS_DENEB: 128,
        getForkName: () => ForkName.gloas,
        getForkBoundaryAtEpoch: (epoch: number) => ({fork: ForkName.gloas, epoch}),
      },
      forkChoice: {
        getFinalizedBlock: () => ({slot: 64}),
        getHead: () => ({slot: 66, blockRoot: toRootHex(rootWithByte(66))}),
        getAllAncestorBlocks: () => [
          {slot: 66, blockRoot: toRootHex(rootWithByte(66))},
          {slot: 65, blockRoot: toRootHex(rootWithByte(65))},
          {slot: 64, blockRoot: toRootHex(rootWithByte(64))},
        ],
      },
      getSerializedExecutionPayloadEnvelope: vi.fn(async (slot: number, _blockRoot: string) => {
        if (slot === 65) return hotBytes;
        return null;
      }),
    } as any;

    const db = {
      executionPayloadEnvelopeArchive: {
        getBinary: vi.fn(async (slot: number) => archivedBySlot.get(slot) ?? null),
      },
    } as any;

    const request = {startSlot: 64, count: 2};

    const responses = [];
    for await (const response of onExecutionPayloadEnvelopesByRange(request, chain, db)) {
      responses.push(ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(response.data));
    }

    expect(responses).toHaveLength(2);
    expect(responses.map((e) => e.message.slot)).toEqual([64, 65]);
  });

  it("returns nothing when requested range has no envelopes", async () => {
    const chain = {
      config: {
        SLOTS_PER_EPOCH: 32,
        MAX_REQUEST_BLOCKS: 1024,
        MAX_REQUEST_BLOCKS_DENEB: 128,
        getForkName: () => ForkName.gloas,
        getForkBoundaryAtEpoch: (epoch: number) => ({fork: ForkName.gloas, epoch}),
      },
      forkChoice: {
        getFinalizedBlock: () => ({slot: 0}),
        getHead: () => ({slot: 0, blockRoot: "0x0000000000000000000000000000000000000000000000000000000000000000"}),
        getAllAncestorBlocks: () => [],
      },
      getSerializedExecutionPayloadEnvelope: vi.fn(async () => null),
    } as any;

    const db = {
      executionPayloadEnvelopeArchive: {getBinary: vi.fn()},
    } as any;

    const request = {startSlot: 1, count: 1};

    const responses = [];
    for await (const response of onExecutionPayloadEnvelopesByRange(request, chain, db)) {
      responses.push(response);
    }

    expect(responses).toHaveLength(0);
    expect(db.executionPayloadEnvelopeArchive.getBinary).not.toHaveBeenCalled();
    expect(chain.getSerializedExecutionPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("serves all slots in range including head", async () => {
    const finalizedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    finalizedEnvelope.message.slot = 64;
    finalizedEnvelope.message.beaconBlockRoot = rootWithByte(64);

    const headEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    headEnvelope.message.slot = 66;
    headEnvelope.message.beaconBlockRoot = rootWithByte(66);

    const slot65Envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    slot65Envelope.message.slot = 65;
    slot65Envelope.message.beaconBlockRoot = rootWithByte(65);

    const finalizedBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(finalizedEnvelope);
    const headBytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(headEnvelope);
    const slot65Bytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(slot65Envelope);

    const archivedBySlot = new Map<number, Uint8Array>([[64, finalizedBytes]]);

    const chain = {
      config: {
        SLOTS_PER_EPOCH: 32,
        MAX_REQUEST_BLOCKS: 1024,
        MAX_REQUEST_BLOCKS_DENEB: 128,
        getForkName: () => ForkName.gloas,
        getForkBoundaryAtEpoch: (epoch: number) => ({fork: ForkName.gloas, epoch}),
      },
      forkChoice: {
        getFinalizedBlock: () => ({slot: 64}),
        getHead: () => ({slot: 66, blockRoot: toRootHex(rootWithByte(66))}),
        getAllAncestorBlocks: () => [
          {slot: 66, blockRoot: toRootHex(rootWithByte(66))},
          {slot: 65, blockRoot: toRootHex(rootWithByte(65))},
          {slot: 64, blockRoot: toRootHex(rootWithByte(64))},
        ],
      },
      getSerializedExecutionPayloadEnvelope: vi.fn(async (slot: number, _blockRoot: string) => {
        if (slot === 66) return headBytes;
        if (slot === 65) return slot65Bytes;
        return null;
      }),
    } as any;

    const db = {
      executionPayloadEnvelopeArchive: {
        getBinary: vi.fn(async (slot: number) => archivedBySlot.get(slot) ?? null),
      },
    } as any;

    const request = {startSlot: 64, count: 3};

    const responses = [];
    for await (const response of onExecutionPayloadEnvelopesByRange(request, chain, db)) {
      responses.push(ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(response.data));
    }

    expect(responses.map((e) => e.message.slot)).toEqual([64, 65, 66]);
  });
});
