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
import {IExecutionEngine} from "../../../src/execution/index.js";

describe("reconstructArchivedEnvelopesByRange", () => {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let controller: LevelDbController;
  let db: BeaconDb;
  let getPayloadBodiesByHash: ReturnType<typeof vi.fn>;
  let executionEngine: IExecutionEngine;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-envelope-reconstruct-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    getPayloadBodiesByHash = vi.fn();
    executionEngine = {getPayloadBodiesByHash} as unknown as IExecutionEngine;
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

  // Seed the archive with the compact form (the write seam does this at hot→cold migration).
  async function seed(slot: number): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const full = makeEnvelope(slot);
    await db.executionPayloadEnvelopeArchive.put(slot, toSignedCompactEnvelope(full));
    return full;
  }

  // Mock the EL to return each seeded envelope's real bodies, keyed by blockHash.
  function elServes(fulls: gloas.SignedExecutionPayloadEnvelope[]): void {
    const byHash = new Map(
      fulls.map((f) => [
        toRootHex(f.message.payload.blockHash),
        {transactions: f.message.payload.transactions, withdrawals: f.message.payload.withdrawals},
      ])
    );
    getPayloadBodiesByHash.mockImplementation(async (_fork: string, hashes: string[]) =>
      hashes.map((h) => byHash.get(h) ?? null)
    );
  }

  const range = (
    start: number,
    end: number
  ): AsyncIterable<{slot: number; envelope: gloas.SignedExecutionPayloadEnvelope}> =>
    reconstructArchivedEnvelopesByRange(db, executionEngine, config, logger, start, end);

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
    expect(getPayloadBodiesByHash).toHaveBeenCalledTimes(1);
    expect(getPayloadBodiesByHash).toHaveBeenCalledWith("gloas", [
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
    expect(getPayloadBodiesByHash).toHaveBeenCalledTimes(2);
    expect(getPayloadBodiesByHash.mock.calls[0][1]).toHaveLength(32);
    expect(getPayloadBodiesByHash.mock.calls[1][1]).toHaveLength(1);
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
    getPayloadBodiesByHash.mockResolvedValue([{transactions: full.message.payload.transactions, withdrawals: null}]);
    const out = await fromAsync(range(10, 11));
    expect(out).toEqual([]);
  });

  it("wraps an EL transport error as ENGINE_UNAVAILABLE (transient)", async () => {
    await seed(10);
    getPayloadBodiesByHash.mockRejectedValue(new Error("ECONNREFUSED"));
    const err = await fromAsync(range(10, 11)).then(
      () => null,
      (e) => e as unknown
    );
    expect(err).toBeInstanceOf(EnvelopeReconstructionError);
    expect((err as EnvelopeReconstructionError).type.code).toBe(EnvelopeReconstructionErrorCode.ENGINE_UNAVAILABLE);
    expect((err as EnvelopeReconstructionError).isTransient()).toBe(true);
  });

  it("yields the first batch before an EL failure on the second batch surfaces", async () => {
    const fulls = [];
    for (let slot = 0; slot < 33; slot++) fulls.push(await seed(slot));
    const byHash = new Map(
      fulls.map((f) => [
        toRootHex(f.message.payload.blockHash),
        {transactions: f.message.payload.transactions, withdrawals: f.message.payload.withdrawals},
      ])
    );
    // First round-trip (32 hashes) succeeds, second (1 hash) fails — the real-world partial-response shape
    getPayloadBodiesByHash
      .mockImplementationOnce(async (_fork: string, hashes: string[]) => hashes.map((h) => byHash.get(h) ?? null))
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

  it("throws when the EL returns transactions that don't match the stored root", async () => {
    await seed(10);
    getPayloadBodiesByHash.mockResolvedValue([
      {transactions: [Uint8Array.from([0xff])], withdrawals: makeEnvelope(10).message.payload.withdrawals},
    ]);
    const err = await fromAsync(range(10, 11)).then(
      () => null,
      (e) => e as EnvelopeReconstructionError
    );
    expect(err?.type.code).toBe(EnvelopeReconstructionErrorCode.TRANSACTIONS_ROOT_MISMATCH);
    expect(err?.isTransient()).toBe(false);
  });

  it("throws when the EL returns withdrawals that don't match the stored root", async () => {
    const full = await seed(10);
    getPayloadBodiesByHash.mockResolvedValue([
      {
        transactions: full.message.payload.transactions,
        withdrawals: [{index: 99, validatorIndex: 99, address: new Uint8Array(20), amount: 1n}],
      },
    ]);
    const err = await fromAsync(range(10, 11)).then(
      () => null,
      (e) => e as EnvelopeReconstructionError
    );
    expect(err?.type.code).toBe(EnvelopeReconstructionErrorCode.WITHDRAWALS_ROOT_MISMATCH);
  });
});
