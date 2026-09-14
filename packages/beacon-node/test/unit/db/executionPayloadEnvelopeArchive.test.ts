import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {reconstructExecutionPayloadEnvelopes} from "../../../src/chain/blocks/reconstructExecutionPayloadEnvelopes.js";
import {BeaconDb} from "../../../src/db/beacon.js";
import {CompactExecutionPayloadEnvelopeArchiveRepository} from "../../../src/db/repositories/compactExecutionPayloadEnvelopeArchive.js";
import {ExecutionPayloadEnvelopeRepository} from "../../../src/db/repositories/executionPayloadEnvelope.js";
import {ExecutionPayloadEnvelopeArchiveRepository} from "../../../src/db/repositories/executionPayloadEnvelopeArchive.js";
import {
  CompactExecutionPayloadEnvelope,
  compactExecutionPayloadEnvelope,
} from "../../../src/db/repositories/executionPayloadEnvelopeArchiveTypes.js";
import {IExecutionEngine} from "../../../src/execution/engine/interface.js";

describe("Gloas payload envelope archive", () => {
  let directory: string;
  let db: LevelDbController;
  let hot: ExecutionPayloadEnvelopeRepository;
  let beaconDb: BeaconDb;
  let archive: ExecutionPayloadEnvelopeArchiveRepository;
  let compactArchive: CompactExecutionPayloadEnvelopeArchiveRepository;
  let envelope: gloas.SignedExecutionPayloadEnvelope;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lodestar-envelope-archive-"));
    db = await LevelDbController.create({name: directory}, {logger: testLogger()});
    hot = new ExecutionPayloadEnvelopeRepository(config, db);
    beaconDb = new BeaconDb(config, db, {dataColumnDir: path.join(directory, "columns"), logger: testLogger()});
    archive = beaconDb.executionPayloadEnvelopeArchive;
    compactArchive = beaconDb.compactExecutionPayloadEnvelopeArchive;
    envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot.fill(1);
    envelope.message.parentBeaconBlockRoot.fill(2);
    envelope.signature.fill(3);
    envelope.message.builderIndex = 4;
    Object.assign(envelope.message.payload, {
      slotNumber: 12,
      blockNumber: 100,
      transactions: [new Uint8Array(64_000).fill(5)],
      withdrawals: [{...ssz.capella.Withdrawal.defaultValue(), amount: 123n}],
      blockAccessList: new Uint8Array(16_000).fill(6),
    });
    await hot.add(envelope);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(directory, {recursive: true, force: true});
  });

  it("atomically replaces the hot envelope with compact metadata and reconstructs identical SSZ after restart", async () => {
    const compact = compactExecutionPayloadEnvelope(envelope);
    const batch = vi.spyOn(db, "batch");
    await beaconDb.archiveExecutionPayloadEnvelopes([], [compact]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0].map((operation) => operation.type)).toEqual(["put", "del", "del"]);
    expect(await hot.get(envelope.message.beaconBlockRoot)).toBeNull();
    expect(await archive.getBinary(12)).toBeNull();
    const bytes = await compactArchive.getBinary(12);
    expect(bytes).toEqual(Buffer.from(CompactExecutionPayloadEnvelope.serialize(compact)));
    expect(bytes?.length).toBeLessThan(1_000);
    expect(await compactArchive.has(12)).toBe(true);

    await db.close();
    db = await LevelDbController.create({name: directory}, {logger: testLogger()});
    beaconDb = new BeaconDb(config, db, {dataColumnDir: path.join(directory, "columns"), logger: testLogger()});
    archive = beaconDb.executionPayloadEnvelopeArchive;
    compactArchive = beaconDb.compactExecutionPayloadEnvelopeArchive;
    const stored = await compactArchive.get(12);
    if (stored === null) throw new Error("Missing compact archived envelope");
    expect(CompactExecutionPayloadEnvelope.serialize(stored)).toEqual(
      CompactExecutionPayloadEnvelope.serialize(compact)
    );
    const engine = {
      getPayloadBodiesByRange: vi.fn<IExecutionEngine["getPayloadBodiesByRange"]>().mockResolvedValue([
        {
          transactions: envelope.message.payload.transactions,
          withdrawals: envelope.message.payload.withdrawals,
          blockAccessList: envelope.message.payload.blockAccessList,
        },
      ]),
    };
    const [reconstructed] = await reconstructExecutionPayloadEnvelopes(engine, [stored]);
    expect(engine.getPayloadBodiesByRange).toHaveBeenCalledWith(ForkName.gloas, 100, 1);
    expect(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(reconstructed)).toEqual(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)
    );
  });

  it("preserves the full hot envelope if the atomic batch fails", async () => {
    vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("write failed"));
    await expect(
      beaconDb.archiveExecutionPayloadEnvelopes([], [compactExecutionPayloadEnvelope(envelope)])
    ).rejects.toThrow("write failed");
    expect(await hot.getBinary(envelope.message.beaconBlockRoot)).toEqual(
      Buffer.from(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope))
    );
    expect(await archive.get(12)).toBeNull();
    expect(await compactArchive.get(12)).toBeNull();
  });

  it("keeps legacy full records and compact records in their own buckets", async () => {
    await archive.putBinary(12, ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope));
    for (const slot of [10, 14]) {
      const next = ssz.gloas.SignedExecutionPayloadEnvelope.clone(envelope);
      next.message.payload.slotNumber = slot;
      await beaconDb.archiveExecutionPayloadEnvelopes([], [compactExecutionPayloadEnvelope(next)]);
    }
    expect(await archive.keys({gte: 10, lt: 15})).toEqual([12]);
    expect(await compactArchive.keys({gte: 10, lt: 15})).toEqual([10, 14]);
    expect(await archive.getBinary(12)).toEqual(
      Buffer.from(ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope))
    );
    expect(await compactArchive.get(12)).toBeNull();
    expect(await archive.has(12)).toBe(true);
    expect(await archive.has(13)).toBe(false);
    expect(await archive.values({gte: 12, lt: 14})).toHaveLength(1);
  });

  it.each([false, true])("keeps one archived record when replacing a slot with compact=%s", async (compact) => {
    const metadata = compactExecutionPayloadEnvelope(envelope);
    await beaconDb.archiveExecutionPayloadEnvelopes(compact ? [envelope] : [], compact ? [] : [metadata]);
    await beaconDb.archiveExecutionPayloadEnvelopes(compact ? [] : [envelope], compact ? [metadata] : []);
    expect(await archive.has(12)).toBe(!compact);
    expect(await compactArchive.has(12)).toBe(compact);
    expect((await archive.keys()).length + (await compactArchive.keys()).length).toBe(1);
  });
});
