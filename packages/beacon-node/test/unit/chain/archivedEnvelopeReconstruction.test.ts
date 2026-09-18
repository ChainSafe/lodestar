import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {LogLevel} from "@lodestar/logger";
import {testLogger} from "@lodestar/logger/test-utils";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {toSignedCompactEnvelope} from "../../../src/chain/archiveStore/utils/compactEnvelope.js";
import {
  ReconstructByRangeOpts,
  ReconstructedEnvelopeCache,
  reconstructArchivedEnvelope,
  reconstructArchivedEnvelopesByRange,
} from "../../../src/chain/archiveStore/utils/reconstructArchivedEnvelopes.js";
import {EnvelopeReconstructionError, EnvelopeReconstructionErrorCode} from "../../../src/chain/errors/index.js";
import {BeaconDb} from "../../../src/db/beacon.js";
import {ArchivedEnvelopeKind} from "../../../src/db/repositories/index.js";
import {ExecutionPayloadBodyV2} from "../../../src/execution/engine/types.js";
import {IExecutionEngine} from "../../../src/execution/index.js";

describe("reconstructArchivedEnvelopesByRange", () => {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let controller: LevelDbController;
  let db: BeaconDb;
  let getPayloadBodiesByHashV2: ReturnType<typeof vi.fn>;
  let executionEngine: IExecutionEngine;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-envelope-reconstruct-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    getPayloadBodiesByHashV2 = vi.fn();
    executionEngine = {getPayloadBodiesByHashV2} as unknown as IExecutionEngine;
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  function makeEnvelope(slot: number): gloas.SignedExecutionPayloadEnvelope {
    const e = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    const p = e.message.payload;
    p.slotNumber = slot;
    p.blockHash = new Uint8Array(32).fill(slot & 0xff);
    p.transactions = [Uint8Array.from([slot, 1, 2]), Uint8Array.from([slot, 3, 4])];
    p.withdrawals = [{index: slot, validatorIndex: 2, address: new Uint8Array(20).fill(0xdd), amount: 99n}];
    p.blockAccessList = Uint8Array.from([slot, 0x22]);
    e.message.beaconBlockRoot = new Uint8Array(32).fill(slot & 0x0f);
    e.signature = new Uint8Array(96).fill(0xee);
    return e;
  }

  function bodyOf(full: gloas.SignedExecutionPayloadEnvelope): ExecutionPayloadBodyV2 {
    const {transactions, withdrawals, blockAccessList} = full.message.payload;
    return {transactions, withdrawals, blockAccessList};
  }

  // Seed the archive with the compact form (the write seam does this at hot→cold migration).
  async function seed(slot: number): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const full = makeEnvelope(slot);
    await db.executionPayloadEnvelopeArchive.put(slot, {
      selector: ArchivedEnvelopeKind.Compact,
      value: toSignedCompactEnvelope(full),
    });
    return full;
  }

  // Mock the EL to return each seeded envelope's real bodies (incl. BAL), keyed by blockHash.
  function elServes(fulls: gloas.SignedExecutionPayloadEnvelope[]): void {
    const byHash = new Map(fulls.map((f) => [toRootHex(f.message.payload.blockHash), bodyOf(f)]));
    getPayloadBodiesByHashV2.mockImplementation(async (hashes: string[]) => hashes.map((h) => byHash.get(h) ?? null));
  }

  // Everything in the archive is inside the serving window unless a test says otherwise
  const inWindow: ReconstructByRangeOpts = {servingWindowStartSlot: 0};

  // Collect the range as deserialized envelopes (the generator yields serialized bytes, as served on the wire),
  // plus the slot the stream stopped short at, if any
  async function rangeWith(
    start: number,
    end: number,
    opts: ReconstructByRangeOpts = inWindow
  ): Promise<{out: {slot: number; envelope: gloas.SignedExecutionPayloadEnvelope}[]; unservableSlot: number | null}> {
    const out = [];
    let unservableSlot: number | null = null;
    for await (const {slot, envelopeBytes} of reconstructArchivedEnvelopesByRange(
      db,
      executionEngine,
      logger,
      start,
      end,
      {
        ...opts,
        onUnservable: (slot) => {
          unservableSlot = slot;
        },
      }
    )) {
      out.push({slot, envelope: ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(envelopeBytes)});
    }
    return {out, unservableSlot};
  }

  async function range(
    start: number,
    end: number
  ): Promise<{slot: number; envelope: gloas.SignedExecutionPayloadEnvelope}[]> {
    return (await rangeWith(start, end)).out;
  }

  const rejection = async (p: Promise<unknown>): Promise<EnvelopeReconstructionError | null> =>
    p.then(
      () => null,
      (e) => e as EnvelopeReconstructionError
    );

  it("reconstructs a range byte-identically to the originals", async () => {
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes(fulls);

    const out = await range(10, 13);

    expect(out.map((o) => o.slot)).toEqual([10, 11, 12]);
    for (const {slot, envelope} of out) {
      const original = fulls.find((f) => f.message.payload.slotNumber === slot);
      if (original === undefined) throw Error(`no seeded envelope for slot ${slot}`);
      expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(envelope, original)).toBe(true);
    }
    // all three slots fit in one batch → a single EL round-trip with all three hashes
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(1);
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledWith([
      toRootHex(new Uint8Array(32).fill(10)),
      toRootHex(new Uint8Array(32).fill(11)),
      toRootHex(new Uint8Array(32).fill(12)),
    ]);
  });

  it("chunks EL fetches at MAX_BODIES_REQUEST (32), not one per slot", async () => {
    const fulls = [];
    for (let slot = 0; slot < 33; slot++) fulls.push(await seed(slot));
    elServes(fulls);

    const out = await range(0, 33);

    expect(out.length).toBe(33);
    // 33 slots → 32 + 1, i.e. two EL round-trips, not 33
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(2);
    expect(getPayloadBodiesByHashV2.mock.calls[0][0]).toHaveLength(32);
    expect(getPayloadBodiesByHashV2.mock.calls[1][0]).toHaveLength(1);
  });

  // Seed a full entry (--chain.dedupePayloads=false) in the same archive.
  async function seedFull(slot: number): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const full = makeEnvelope(slot);
    await db.executionPayloadEnvelopeArchive.put(slot, {selector: ArchivedEnvelopeKind.Full, value: full});
    return full;
  }

  it("interleaves full entries (dedupePayloads=false) in slot order without hitting the EL for them", async () => {
    const fulls = [await seed(10), await seed(12)];
    const archivedFull = await seedFull(11);
    elServes(fulls);

    const out = await range(10, 13);

    expect(out.map((o) => o.slot)).toEqual([10, 11, 12]);
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(out[1].envelope, archivedFull)).toBe(true);
    // only the two compact entries go to the EL
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(1);
    expect(getPayloadBodiesByHashV2.mock.calls[0][0]).toHaveLength(2);
  });

  it("serves a full-only range without calling the EL", async () => {
    await seedFull(10);
    const out = await range(10, 11);
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(getPayloadBodiesByHashV2).not.toHaveBeenCalled();
  });

  it("respects the [gte, lt) bounds", async () => {
    elServes([await seed(10), await seed(11), await seed(12)]);
    const out = await range(11, 12);
    expect(out.map((o) => o.slot)).toEqual([11]);
  });

  it("ends the stream at the first slot the EL cannot serve instead of leaving a hole", async () => {
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes([fulls[0], fulls[2]]); // EL knows 10 and 12 but not 11
    const {out, unservableSlot} = await rangeWith(10, 13);
    // 12 is servable but a response [10, 12] would look like a hole to a peer that knows 11 is FULL
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(unservableSlot).toBe(11);
  });

  it("ends the stream on a pre-capella body shape (null withdrawals)", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(full), withdrawals: null}]);
    const {out, unservableSlot} = await rangeWith(10, 11);
    expect(out).toEqual([]);
    expect(unservableSlot).toBe(10);
  });

  it.each<[string, Uint8Array | null]>([
    ["null", null],
    ["empty bytes (0x, as some ELs return once pruned)", new Uint8Array(0)],
  ])("ends the stream when the EL returns a %s block access list", async (_label, blockAccessList) => {
    const fulls = [await seed(10), await seed(11)];
    getPayloadBodiesByHashV2.mockResolvedValue([bodyOf(fulls[0]), {...bodyOf(fulls[1]), blockAccessList}]);
    const {out, unservableSlot} = await rangeWith(10, 12);
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(unservableSlot).toBe(11);
  });

  it("reports no unservable slot when the range is simply empty", async () => {
    const {out, unservableSlot} = await rangeWith(10, 12);
    expect(out).toEqual([]);
    expect(unservableSlot).toBeNull();
    expect(getPayloadBodiesByHashV2).not.toHaveBeenCalled();
  });

  it("still attempts compact entries below the serving window: the EL's retention is the floor, not the spec window", async () => {
    // window starts at 12, but the EL still has 10 and 11 → served; the window is advisory
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes(fulls);
    const {out, unservableSlot} = await rangeWith(10, 13, {servingWindowStartSlot: 12});
    expect(out.map((o) => o.slot)).toEqual([10, 11, 12]);
    expect(unservableSlot).toBeNull();
  });

  it("logs a miss below the serving window at debug and inside it at warn", async () => {
    const debug = vi.spyOn(logger, LogLevel.debug);
    const warn = vi.spyOn(logger, LogLevel.warn);
    const fulls = [await seed(10), await seed(20)];
    elServes([]); // EL has neither

    await rangeWith(10, 11, {servingWindowStartSlot: 15});
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("below serving window"),
      expect.objectContaining({slot: 10})
    );

    await rangeWith(20, 21, {servingWindowStartSlot: 15});
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("inside serving window"),
      expect.objectContaining({slot: 20})
    );
    expect(fulls).toHaveLength(2);
  });

  it("serves a recently reconstructed envelope from the cache without an EL call", async () => {
    const fulls = [await seed(10), await seed(11)];
    elServes(fulls);
    const cache = new ReconstructedEnvelopeCache();
    expect((await rangeWith(10, 12, {...inWindow, cache})).out.map((o) => o.slot)).toEqual([10, 11]);
    expect(cache.size).toBe(2);
    getPayloadBodiesByHashV2.mockClear();
    // second pass: both served from cache, byte-identical, no EL round-trip
    const {out} = await rangeWith(10, 12, {...inWindow, cache});
    expect(out.map((o) => o.slot)).toEqual([10, 11]);
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(out[1].envelope, fulls[1])).toBe(true);
    expect(getPayloadBodiesByHashV2).not.toHaveBeenCalled();
  });

  it("caches only successful reconstructions and evicts oldest first past its size", async () => {
    const cache = new ReconstructedEnvelopeCache(2);
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes([fulls[0], fulls[1]]); // 12 unservable
    await rangeWith(10, 13, {...inWindow, cache});
    expect(cache.get(12)).toBeUndefined();
    expect(cache.get(10)).toBeDefined();
    cache.set(13, new Uint8Array(1));
    expect(cache.size).toBe(2);
    expect(cache.get(10)).toBeUndefined(); // FIFO
    expect(cache.get(11)).toBeDefined();
  });

  it("wraps an EL transport error as ENGINE_UNAVAILABLE (transient)", async () => {
    await seed(10);
    getPayloadBodiesByHashV2.mockRejectedValue(new Error("ECONNREFUSED"));
    const err = await rejection(range(10, 11));
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    expect(err?.type.code).toBe(EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE);
    expect(err?.isTransient()).toBe(true);
  });

  it("yields the first batch before an EL failure on the second batch surfaces", async () => {
    const fulls = [];
    for (let slot = 0; slot < 33; slot++) fulls.push(await seed(slot));
    const byHash = new Map(fulls.map((f) => [toRootHex(f.message.payload.blockHash), bodyOf(f)]));
    // First round-trip (32 hashes) succeeds, second (1 hash) fails — the real-world partial-response shape
    getPayloadBodiesByHashV2
      .mockImplementationOnce(async (hashes: string[]) => hashes.map((h) => byHash.get(h) ?? null))
      .mockRejectedValueOnce(new Error("EL went away"));

    const yielded: number[] = [];
    let err: unknown = null;
    try {
      for await (const {slot} of reconstructArchivedEnvelopesByRange(db, executionEngine, logger, 0, 33, inWindow)) {
        yielded.push(slot);
      }
    } catch (e) {
      err = e;
    }

    expect(yielded).toHaveLength(32);
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    expect((err as EnvelopeReconstructionError).isTransient()).toBe(true);
  });

  it.each<[string, Partial<ExecutionPayloadBodyV2>]>([
    ["transactions", {transactions: [Uint8Array.from([0xff])]}],
    ["withdrawals", {withdrawals: [{index: 99, validatorIndex: 99, address: new Uint8Array(20), amount: 1n}]}],
    ["blockAccessList", {blockAccessList: Uint8Array.from([0xff])}],
  ])("ends the range (no throw) when the EL returns %s that don't match the archived root", async (_f, override) => {
    const fulls = [await seed(10), await seed(11)];
    // 10 mismatches: a local inconsistency, but on the p2p path the peer just sees a short response
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(fulls[0]), ...override}, bodyOf(fulls[1])]);
    const {out, unservableSlot} = await rangeWith(10, 12);
    expect(out).toEqual([]);
    expect(unservableSlot).toBe(10);
  });

  it("keeps PAYLOAD_ROOT_MISMATCH as a throw on the getter path (REST 500 / by-root SERVER_ERROR)", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(full), transactions: [Uint8Array.from([0xff])]}]);
    const err = await rejection(reconstructArchivedEnvelope(executionEngine, toSignedCompactEnvelope(full)));
    expect(err?.type.code).toBe(EnvelopeReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH);
    expect(err?.isTransient()).toBe(false);
  });

  it("returns null from the getter path when the EL cannot serve the bodies", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([null]);
    expect(await reconstructArchivedEnvelope(executionEngine, toSignedCompactEnvelope(full))).toBeNull();
  });
});
