import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {migrateExecutionPayloadEnvelopesFromHotToColdDb} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {toSignedCompactEnvelope} from "../../../../src/chain/archiveStore/utils/compactEnvelope.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {
  ArchivedEnvelopeKind,
  SignedCompactExecutionPayloadEnvelope,
  signedCompactExecutionPayloadEnvelopeSsz,
} from "../../../../src/db/repositories/index.js";

describe("migrateExecutionPayloadEnvelopesFromHotToColdDb", () => {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let controller: LevelDbController;
  let db: BeaconDb;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-envelope-migration-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  function makeEnvelope(slot: number): gloas.SignedExecutionPayloadEnvelope {
    const e = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    const p = e.message.payload;
    p.slotNumber = slot;
    // slot-unique roots/hashes (two bytes, so >256 slots don't collide)
    p.blockHash = Uint8Array.from([0xaa, slot >> 8, slot & 0xff, ...new Uint8Array(29)]);
    p.transactions = [Uint8Array.from([slot & 0xff, 1, 2])];
    p.blockAccessList = Uint8Array.from([slot & 0xff, 0x22]);
    e.message.beaconBlockRoot = Uint8Array.from([0xbb, slot >> 8, slot & 0xff, ...new Uint8Array(29)]);
    return e;
  }

  /** Put a full envelope in the hot db and return the finalized ProtoBlock stub that references it */
  async function seedHot(
    slot: number,
    payloadStatus = PayloadStatus.FULL,
    executionStatus = ExecutionStatus.Valid
  ): Promise<ProtoBlock> {
    const envelope = makeEnvelope(slot);
    await db.executionPayloadEnvelope.put(envelope.message.beaconBlockRoot, envelope);
    return {
      slot,
      blockRoot: toRootHex(envelope.message.beaconBlockRoot),
      payloadStatus,
      executionStatus,
    } as unknown as ProtoBlock;
  }

  it("archives compact envelopes by default (dedupePayloads=true) and removes them from hot", async () => {
    const blocks = [await seedHot(10), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    for (const slot of [10, 11]) {
      const archived = await db.executionPayloadEnvelopeArchive.get(slot);
      expect(archived?.selector).toBe(ArchivedEnvelopeKind.Compact);
      expect(
        signedCompactExecutionPayloadEnvelopeSsz.equals(
          archived?.value as SignedCompactExecutionPayloadEnvelope,
          toSignedCompactEnvelope(makeEnvelope(slot))
        )
      ).toBe(true);
      expect(await db.executionPayloadEnvelope.get(makeEnvelope(slot).message.beaconBlockRoot)).toBeNull();
    }
  });

  it("archives full envelopes with dedupePayloads=false", async () => {
    const blocks = [await seedHot(10)];

    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, false);

    const archived = await db.executionPayloadEnvelopeArchive.get(10);
    expect(archived?.selector).toBe(ArchivedEnvelopeKind.Full);
    expect(
      ssz.gloas.SignedExecutionPayloadEnvelope.equals(
        archived?.value as gloas.SignedExecutionPayloadEnvelope,
        makeEnvelope(10)
      )
    ).toBe(true);
    expect(await db.executionPayloadEnvelope.get(makeEnvelope(10).message.beaconBlockRoot)).toBeNull();
  });

  it("serves a mixed archive through the union: both forms round-trip from the same bucket", async () => {
    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [await seedHot(10)], true);
    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [await seedHot(11)], false);

    expect((await db.executionPayloadEnvelopeArchive.get(10))?.selector).toBe(ArchivedEnvelopeKind.Compact);
    expect((await db.executionPayloadEnvelopeArchive.get(11))?.selector).toBe(ArchivedEnvelopeKind.Full);
  });

  it("archives in full when the block is not yet execution-valid, even with dedupePayloads=true", async () => {
    // Optimistic import: the EL has not validated this payload, so it may not serve its bodies later
    const blocks = [await seedHot(10, PayloadStatus.FULL, ExecutionStatus.Syncing), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    expect((await db.executionPayloadEnvelopeArchive.get(10))?.selector).toBe(ArchivedEnvelopeKind.Full);
    expect((await db.executionPayloadEnvelopeArchive.get(11))?.selector).toBe(ArchivedEnvelopeKind.Compact);
  });

  it("migrates more blocks than one batch, in one atomic write per batch", async () => {
    const blocks: ProtoBlock[] = [];
    for (let slot = 0; slot < 300; slot++) blocks.push(await seedHot(slot)); // > BLOCK_BATCH_SIZE (256)

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toHaveLength(300);
    expect((await db.executionPayloadEnvelopeArchive.get(0))?.selector).toBe(ArchivedEnvelopeKind.Compact);
    expect((await db.executionPayloadEnvelopeArchive.get(299))?.selector).toBe(ArchivedEnvelopeKind.Compact);
    expect(await db.executionPayloadEnvelope.get(makeEnvelope(299).message.beaconBlockRoot)).toBeNull();
  });

  it("skips EMPTY payload-status blocks and blocks missing from hot", async () => {
    const empty = await seedHot(10, PayloadStatus.EMPTY);
    const missing = {slot: 11, blockRoot: toRootHex(new Uint8Array(32).fill(0xff)), payloadStatus: PayloadStatus.FULL};

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(
      config,
      db,
      logger,
      [empty, missing as unknown as ProtoBlock],
      true
    );

    expect(migrated).toEqual([]);
    expect(await db.executionPayloadEnvelopeArchive.get(10)).toBeNull();
    expect(await db.executionPayloadEnvelopeArchive.get(11)).toBeNull();
  });
});
