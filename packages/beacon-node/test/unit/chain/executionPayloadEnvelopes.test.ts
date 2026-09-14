import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {RespStatus} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {fromAsync, toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../src/api/impl/beacon/blocks/index.js";
import {ApiModules} from "../../../src/api/index.js";
import {BeaconChain} from "../../../src/chain/chain.js";
import {IBeaconDb} from "../../../src/db/interface.js";
import {compactExecutionPayloadEnvelope} from "../../../src/db/repositories/executionPayloadEnvelopeArchiveTypes.js";
import {IExecutionEngine} from "../../../src/execution/engine/interface.js";
import {onExecutionPayloadEnvelopesByRange} from "../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRange.js";
import {onExecutionPayloadEnvelopesByRoot} from "../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRoot.js";

async function* values<T>(items: T[]): AsyncIterable<T> {
  yield* items;
}

describe("Gloas envelope reads", () => {
  const config = createBeaconConfig(
    {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    },
    new Uint8Array(32)
  );
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = 10;
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  envelope.message.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
  envelope.message.payload.slotNumber = 10;
  envelope.message.payload.blockNumber = 100;
  envelope.message.executionRequests.builderExits.push(ssz.gloas.BuilderExitRequest.defaultValue());
  const root = toRootHex(envelope.message.beaconBlockRoot);
  const compact = compactExecutionPayloadEnvelope(envelope);
  const engine = {getPayloadBodiesByRange: vi.fn<IExecutionEngine["getPayloadBodiesByRange"]>()};
  const db = {
    executionPayloadEnvelope: {get: vi.fn(), getBinary: vi.fn()},
    executionPayloadEnvelopeArchive: {
      get: vi.fn(),
      valuesStream: vi.fn<IBeaconDb["executionPayloadEnvelopeArchive"]["valuesStream"]>(),
    },
    compactExecutionPayloadEnvelopeArchive: {
      get: vi.fn(),
      valuesStream: vi.fn<IBeaconDb["compactExecutionPayloadEnvelopeArchive"]["valuesStream"]>(),
    },
    blockArchive: {getSlotByRoot: vi.fn()},
  };
  let chain: BeaconChain;

  beforeEach(() => {
    db.executionPayloadEnvelope.get.mockResolvedValue(null);
    db.executionPayloadEnvelope.getBinary.mockResolvedValue(null);
    db.executionPayloadEnvelopeArchive.get.mockResolvedValue(null);
    db.executionPayloadEnvelopeArchive.valuesStream.mockImplementation(() => values([]));
    db.compactExecutionPayloadEnvelopeArchive.get.mockResolvedValue(compact);
    db.compactExecutionPayloadEnvelopeArchive.valuesStream.mockImplementation(() => values([compact]));
    db.blockArchive.getSlotByRoot.mockResolvedValue(10);
    engine.getPayloadBodiesByRange.mockResolvedValue([
      {
        transactions: envelope.message.payload.transactions,
        withdrawals: envelope.message.payload.withdrawals,
        blockAccessList: envelope.message.payload.blockAccessList,
      },
    ]);
    chain = Object.assign(Object.create(BeaconChain.prototype) as BeaconChain, {
      config,
      db,
      executionEngine: engine,
      emitter: {emit: vi.fn()},
      earliestAvailableSlot: 0,
      getBlockByRoot: vi.fn().mockResolvedValue({block, executionOptimistic: false, finalized: true}),
      forkChoice: {getFinalizedBlock: () => ({slot: 20}), getBlockHexDefaultStatus: () => null},
      seenPayloadEnvelopeInputCache: {get: vi.fn()},
    });
  });

  it.each([false, true])("serves reconstructed REST envelopes with returnBytes=%s", async (returnBytes) => {
    const api = getBeaconBlockApi({chain, config, db} as unknown as ApiModules);
    const response = await api.getSignedExecutionPayloadEnvelope({blockId: root}, {returnBytes});
    expect(response.data).toEqual(
      returnBytes ? ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope) : envelope
    );
    expect(response.meta).toEqual({executionOptimistic: false, finalized: true, version: ForkName.gloas});
  });

  it.each([false, true])("reports missing EL bodies as REST 500 with returnBytes=%s", async (returnBytes) => {
    engine.getPayloadBodiesByRange.mockResolvedValue([null]);
    const api = getBeaconBlockApi({chain, config, db} as unknown as ApiModules);
    await expect(api.getSignedExecutionPayloadEnvelope({blockId: root}, {returnBytes})).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("reports a missing envelope as REST 404 without calling the EL", async () => {
    db.compactExecutionPayloadEnvelopeArchive.get.mockResolvedValue(null);
    const api = getBeaconBlockApi({chain, config, db} as unknown as ApiModules);
    await expect(api.getSignedExecutionPayloadEnvelope({blockId: root})).rejects.toMatchObject({statusCode: 404});
    expect(engine.getPayloadBodiesByRange).not.toHaveBeenCalled();
  });

  it("returns full objects and original SSZ bytes from compact records", async () => {
    expect(await chain.getExecutionPayloadEnvelope(10, root)).toEqual(envelope);
    expect(await chain.getSerializedExecutionPayloadEnvelope(10, root)).toEqual(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)
    );
    expect(engine.getPayloadBodiesByRange).toHaveBeenCalledWith(ForkName.gloas, 100, 1);
  });

  it("reads parent execution requests without calling the EL", async () => {
    engine.getPayloadBodiesByRange.mockRejectedValue(new Error("EL offline"));
    expect(await chain.getParentExecutionRequests(10, root)).toEqual(envelope.message.executionRequests);
    expect(engine.getPayloadBodiesByRange).not.toHaveBeenCalled();
  });

  it("does not return a canonical envelope for a different beacon root at the same slot", async () => {
    const other = toRootHex(new Uint8Array(32).fill(2));
    expect(await chain.getExecutionPayloadEnvelope(10, other)).toBeNull();
    expect(await chain.getSerializedExecutionPayloadEnvelope(10, other)).toBeNull();
    expect(engine.getPayloadBodiesByRange).not.toHaveBeenCalled();
  });

  it("serves hot and legacy archived envelopes without calling the EL", async () => {
    db.executionPayloadEnvelope.get.mockResolvedValueOnce(envelope);
    expect(await chain.getExecutionPayloadEnvelope(10, root)).toEqual(envelope);
    db.executionPayloadEnvelopeArchive.get.mockResolvedValue(envelope);
    expect(await chain.getExecutionPayloadEnvelope(10, root)).toEqual(envelope);
    expect(await chain.getSerializedExecutionPayloadEnvelope(10, root)).toEqual(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)
    );
    expect(engine.getPayloadBodiesByRange).not.toHaveBeenCalled();
  });

  it("merges full and reconstructed archived envelopes in slot order", async () => {
    const envelopes = [8, 10, 12, 14, 16].map((slot, index) => {
      const full = ssz.gloas.SignedExecutionPayloadEnvelope.clone(envelope);
      full.message.payload.slotNumber = slot;
      full.message.payload.blockNumber = 99 + index;
      return full;
    });
    db.executionPayloadEnvelopeArchive.valuesStream.mockImplementation(() =>
      values([envelopes[0], envelopes[2], envelopes[4]])
    );
    db.compactExecutionPayloadEnvelopeArchive.valuesStream.mockImplementation(() =>
      values([compactExecutionPayloadEnvelope(envelopes[1]), compactExecutionPayloadEnvelope(envelopes[3])])
    );
    expect(await fromAsync(chain.getArchivedExecutionPayloadEnvelopes(8, 17))).toEqual(envelopes);
    expect(engine.getPayloadBodiesByRange.mock.calls).toEqual([
      [ForkName.gloas, 100, 1],
      [ForkName.gloas, 102, 1],
    ]);
    expect(db.executionPayloadEnvelopeArchive.valuesStream).toHaveBeenCalledWith({gte: 8, lt: 17});
    expect(db.compactExecutionPayloadEnvelopeArchive.valuesStream).toHaveBeenCalledWith({gte: 8, lt: 17});
  });

  it("serves an entirely full archive range without the EL", async () => {
    db.executionPayloadEnvelopeArchive.valuesStream.mockImplementation(() => values([envelope]));
    db.compactExecutionPayloadEnvelopeArchive.valuesStream.mockImplementation(() => values([]));
    expect(await fromAsync(chain.getArchivedExecutionPayloadEnvelopes(10, 11))).toEqual([envelope]);
    expect(engine.getPayloadBodiesByRange).not.toHaveBeenCalled();
  });

  it.each(["range", "root"])("serves reconstructed envelopes through P2P by %s", async (method) => {
    const responses = await fromAsync(
      method === "range"
        ? onExecutionPayloadEnvelopesByRange({startSlot: 10, count: 1}, chain, undefined as never, "test")
        : onExecutionPayloadEnvelopesByRoot(
            [envelope.message.beaconBlockRoot],
            chain,
            db as never,
            undefined as never,
            "test"
          )
    );
    expect(responses).toHaveLength(1);
    expect(responses[0].data).toEqual(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope));
  });

  it.each(["range", "root"])("reports unavailable payload bodies through P2P by %s", async (method) => {
    engine.getPayloadBodiesByRange.mockResolvedValue([null]);
    await expect(
      fromAsync(
        method === "range"
          ? onExecutionPayloadEnvelopesByRange({startSlot: 10, count: 1}, chain, undefined as never, "test")
          : onExecutionPayloadEnvelopesByRoot(
              [envelope.message.beaconBlockRoot],
              chain,
              db as never,
              undefined as never,
              "test"
            )
      )
    ).rejects.toMatchObject({status: RespStatus.RESOURCE_UNAVAILABLE});
  });
});
