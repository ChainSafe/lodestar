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

    const archivedBySlot = new Map<number, typeof finalizedEnvelope>([[64, finalizedEnvelope]]);
    const hotByRoot = new Map<string, typeof hotEnvelope>([
      [toRootHex(hotEnvelope.message.beaconBlockRoot), hotEnvelope],
    ]);

    const chain = {
      earliestAvailableSlot: 1,
      logger: {verbose: vi.fn()},
      config: {
        SLOTS_PER_EPOCH: 32,
        MAX_REQUEST_BLOCKS: 1024,
        MAX_REQUEST_BLOCKS_DENEB: 128,
        getForkName: () => ForkName.gloas,
        getForkBoundaryAtEpoch: (epoch: number) => ({fork: ForkName.gloas, epoch}),
      },
      forkChoice: {
        getFinalizedCheckpointSlot: () => 64,
        getHeadRoot: () => "0xhead",
        getBlockHexDefaultStatus: () => ({slot: 66, blockRoot: toRootHex(rootWithByte(66))}),
        getAllAncestorBlocks: () => [
          {slot: 66, blockRoot: toRootHex(rootWithByte(66))},
          {slot: 65, blockRoot: toRootHex(rootWithByte(65))},
          {slot: 64, blockRoot: toRootHex(rootWithByte(64))},
        ],
      },
    } as any;

    const db = {
      executionPayloadEnvelopeArchive: {
        get: vi.fn(async (slot: number) => archivedBySlot.get(slot) ?? null),
      },
      executionPayloadEnvelope: {
        get: vi.fn(async (root: Uint8Array) => hotByRoot.get(toRootHex(root)) ?? null),
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

  it("returns nothing for requests below earliestAvailableSlot", async () => {
    const chain = {
      earliestAvailableSlot: 10,
      logger: {verbose: vi.fn()},
      config: {
        SLOTS_PER_EPOCH: 32,
        MAX_REQUEST_BLOCKS: 1024,
        MAX_REQUEST_BLOCKS_DENEB: 128,
        getForkName: () => ForkName.gloas,
        getForkBoundaryAtEpoch: (epoch: number) => ({fork: ForkName.gloas, epoch}),
      },
      forkChoice: {
        getFinalizedCheckpointSlot: () => 0,
        getHeadRoot: () => "0xhead",
        getBlockHexDefaultStatus: () => undefined,
        getAllAncestorBlocks: () => [],
      },
    } as any;

    const db = {
      executionPayloadEnvelopeArchive: {get: vi.fn()},
      executionPayloadEnvelope: {get: vi.fn()},
    } as any;

    const request = {startSlot: 1, count: 1};

    const responses = [];
    for await (const response of onExecutionPayloadEnvelopesByRange(request, chain, db)) {
      responses.push(response);
    }

    expect(responses).toHaveLength(0);
    expect(chain.logger.verbose).toHaveBeenCalledTimes(1);
    expect(db.executionPayloadEnvelopeArchive.get).not.toHaveBeenCalled();
    expect(db.executionPayloadEnvelope.get).not.toHaveBeenCalled();
  });

  it("includes head envelope when ancestor list excludes head", async () => {
    const finalizedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    finalizedEnvelope.message.slot = 64;
    finalizedEnvelope.message.beaconBlockRoot = rootWithByte(64);

    const headEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    headEnvelope.message.slot = 66;
    headEnvelope.message.beaconBlockRoot = rootWithByte(66);

    const slot65Envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    slot65Envelope.message.slot = 65;
    slot65Envelope.message.beaconBlockRoot = rootWithByte(65);

    const archivedBySlot = new Map<number, typeof finalizedEnvelope>([[64, finalizedEnvelope]]);
    const hotByRoot = new Map<string, typeof headEnvelope>([
      [toRootHex(headEnvelope.message.beaconBlockRoot), headEnvelope],
      [toRootHex(slot65Envelope.message.beaconBlockRoot), slot65Envelope],
    ]);

    const chain = {
      earliestAvailableSlot: 1,
      logger: {verbose: vi.fn()},
      config: {
        SLOTS_PER_EPOCH: 32,
        MAX_REQUEST_BLOCKS: 1024,
        MAX_REQUEST_BLOCKS_DENEB: 128,
        getForkName: () => ForkName.gloas,
        getForkBoundaryAtEpoch: (epoch: number) => ({fork: ForkName.gloas, epoch}),
      },
      forkChoice: {
        getFinalizedCheckpointSlot: () => 64,
        getHeadRoot: () => "0xhead",
        getBlockHexDefaultStatus: () => ({slot: 66, blockRoot: toRootHex(rootWithByte(66))}),
        getAllAncestorBlocks: () => [
          {slot: 65, blockRoot: toRootHex(rootWithByte(65))},
          {slot: 64, blockRoot: toRootHex(rootWithByte(64))},
        ],
      },
    } as any;

    const db = {
      executionPayloadEnvelopeArchive: {
        get: vi.fn(async (slot: number) => archivedBySlot.get(slot) ?? null),
      },
      executionPayloadEnvelope: {
        get: vi.fn(async (root: Uint8Array) => hotByRoot.get(toRootHex(root)) ?? null),
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
