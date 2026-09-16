import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {migrateExecutionPayloadEnvelopesFromHotToColdDb} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {toSignedCompactEnvelope} from "../../../../src/chain/archiveStore/utils/compactEnvelope.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {ArchivedEnvelopeKind} from "../../../../src/db/repositories/index.js";

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
    p.blockHash = new Uint8Array(32).fill(slot & 0xff);
    p.transactions = [Uint8Array.from([slot, 1, 2])];
    p.blockAccessList = Uint8Array.from([slot, 0x22]);
    e.message.beaconBlockRoot = new Uint8Array(32).fill(0x10 + slot);
    return e;
  }

  /** Put a full envelope in the hot db and return the finalized ProtoBlock stub that references it */
  async function seedHot(slot: number, payloadStatus = PayloadStatus.FULL): Promise<ProtoBlock> {
    const envelope = makeEnvelope(slot);
    await db.executionPayloadEnvelope.put(envelope.message.beaconBlockRoot, envelope);
    return {slot, blockRoot: toRootHex(envelope.message.beaconBlockRoot), payloadStatus} as unknown as ProtoBlock;
  }

  it("archives compact envelopes by default (dedupePayloads=true) and removes them from hot", async () => {
    const blocks = [await seedHot(10), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    for (const slot of [10, 11]) {
      const archived = await db.executionPayloadEnvelopeArchive.get(slot);
      expect(archived?.selector).toBe(ArchivedEnvelopeKind.Compact);
      expect(
        ssz.gloas.SignedCompactExecutionPayloadEnvelope.equals(
          archived?.value as gloas.SignedCompactExecutionPayloadEnvelope,
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
