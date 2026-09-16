import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {gloas, ssz} from "@lodestar/types";
import {fromAsync, toRootHex} from "@lodestar/utils";
import {toSignedCompactEnvelope} from "../../../src/chain/archiveStore/utils/compactEnvelope.js";
import {reconstructArchivedEnvelopesByRange} from "../../../src/chain/archiveStore/utils/reconstructArchivedEnvelopes.js";
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

  const range = (
    start: number,
    end: number
  ): AsyncIterable<{slot: number; envelope: gloas.SignedExecutionPayloadEnvelope}> =>
    reconstructArchivedEnvelopesByRange(db, executionEngine, logger, start, end);

  const rejection = async (iter: AsyncIterable<unknown>): Promise<EnvelopeReconstructionError | null> =>
    fromAsync(iter).then(
      () => null,
      (e) => e as EnvelopeReconstructionError
    );

  it("reconstructs a range byte-identically to the originals", async () => {
    const fulls = [await seed(10), await seed(11), await seed(12)];
    elServes(fulls);

    const out = await fromAsync(range(10, 13));

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

    const out = await fromAsync(range(0, 33));

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

    const out = await fromAsync(range(10, 13));

    expect(out.map((o) => o.slot)).toEqual([10, 11, 12]);
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.equals(out[1].envelope, archivedFull)).toBe(true);
    // only the two compact entries go to the EL
    expect(getPayloadBodiesByHashV2).toHaveBeenCalledTimes(1);
    expect(getPayloadBodiesByHashV2.mock.calls[0][0]).toHaveLength(2);
  });

  it("serves a full-only range without calling the EL", async () => {
    await seedFull(10);
    const out = await fromAsync(range(10, 11));
    expect(out.map((o) => o.slot)).toEqual([10]);
    expect(getPayloadBodiesByHashV2).not.toHaveBeenCalled();
  });

  it("respects the [gte, lt) bounds", async () => {
    elServes([await seed(10), await seed(11), await seed(12)]);
    const out = await fromAsync(range(11, 12));
    expect(out.map((o) => o.slot)).toEqual([11]);
  });

  it("skips slots the EL cannot serve (null body)", async () => {
    const fulls = [await seed(10), await seed(11)];
    elServes([fulls[0]]); // EL knows 10 but not 11
    const out = await fromAsync(range(10, 12));
    expect(out.map((o) => o.slot)).toEqual([10]);
  });

  it("skips slots with a pre-capella body shape (null withdrawals)", async () => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(full), withdrawals: null}]);
    const out = await fromAsync(range(10, 11));
    expect(out).toEqual([]);
  });

  it("skips slots whose block access list the EL has pruned (null blockAccessList)", async () => {
    const fulls = [await seed(10), await seed(11)];
    getPayloadBodiesByHashV2.mockResolvedValue([bodyOf(fulls[0]), {...bodyOf(fulls[1]), blockAccessList: null}]);
    const out = await fromAsync(range(10, 12));
    expect(out.map((o) => o.slot)).toEqual([10]);
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
      for await (const {slot} of range(0, 33)) yielded.push(slot);
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
  ])("throws PAYLOAD_ROOT_MISMATCH when the EL returns %s that don't match the archived root", async (_f, override) => {
    const full = await seed(10);
    getPayloadBodiesByHashV2.mockResolvedValue([{...bodyOf(full), ...override}]);
    const err = await rejection(range(10, 11));
    expect(err?.type.code).toBe(EnvelopeReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH);
    expect(err?.isTransient()).toBe(false);
  });
});
