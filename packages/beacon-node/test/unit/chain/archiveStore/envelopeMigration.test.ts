import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {migrateExecutionPayloadEnvelopesFromHotToColdDb} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {ArchivedEnvelopeKind} from "../../../../src/db/repositories/index.js";
import {toSignedBlindedEnvelope} from "../../../../src/util/blindedEnvelope.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {generateProtoBlock, generateSignedExecutionPayloadEnvelope} from "../../../utils/typeGenerator.js";

describe("migrateExecutionPayloadEnvelopesFromHotToColdDb", () => {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const logger = testLogger();
  let db: BeaconDb;
  let closeDb: () => Promise<void>;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config, "lodestar-envelope-migration-"));
  });

  afterEach(() => closeDb());

  /** Put a full envelope in the hot db and return the finalized ProtoBlock stub that references it */
  async function seedHot(
    slot: number,
    payloadStatus = PayloadStatus.FULL,
    executionStatus = ExecutionStatus.Valid
  ): Promise<ProtoBlock> {
    const envelope = generateSignedExecutionPayloadEnvelope(slot);
    await db.executionPayloadEnvelope.put(envelope.message.beaconBlockRoot, envelope);
    return generateProtoBlock({
      slot,
      blockRoot: toRootHex(envelope.message.beaconBlockRoot),
      payloadStatus,
      executionStatus,
    });
  }

  it("archives blinded envelopes by default (dedupePayloads=true) and removes them from hot", async () => {
    const blocks = [await seedHot(10), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    for (const slot of [10, 11]) {
      const archived = await db.executionPayloadEnvelopeArchive.get(slot);
      expect(archived?.selector).toBe(ArchivedEnvelopeKind.Blinded);
      expect(
        ssz.gloas.SignedBlindedExecutionPayloadEnvelope.equals(
          archived?.value as gloas.SignedBlindedExecutionPayloadEnvelope,
          toSignedBlindedEnvelope(generateSignedExecutionPayloadEnvelope(slot))
        )
      ).toBe(true);
      expect(
        await db.executionPayloadEnvelope.get(generateSignedExecutionPayloadEnvelope(slot).message.beaconBlockRoot)
      ).toBeNull();
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
        generateSignedExecutionPayloadEnvelope(10)
      )
    ).toBe(true);
    expect(
      await db.executionPayloadEnvelope.get(generateSignedExecutionPayloadEnvelope(10).message.beaconBlockRoot)
    ).toBeNull();
  });

  it("serves a mixed archive through the union: both forms round-trip from the same bucket", async () => {
    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [await seedHot(10)], true);
    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [await seedHot(11)], false);

    expect((await db.executionPayloadEnvelopeArchive.get(10))?.selector).toBe(ArchivedEnvelopeKind.Blinded);
    expect((await db.executionPayloadEnvelopeArchive.get(11))?.selector).toBe(ArchivedEnvelopeKind.Full);
  });

  it("archives in full when the block is not yet execution-valid, even with dedupePayloads=true", async () => {
    // Optimistic import: the EL has not validated this payload, so it may not serve its bodies later
    const blocks = [await seedHot(10, PayloadStatus.FULL, ExecutionStatus.Syncing), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    expect((await db.executionPayloadEnvelopeArchive.get(10))?.selector).toBe(ArchivedEnvelopeKind.Full);
    expect((await db.executionPayloadEnvelopeArchive.get(11))?.selector).toBe(ArchivedEnvelopeKind.Blinded);
  });

  it("migrates more blocks than one batch, in one atomic write per batch", async () => {
    const blocks: ProtoBlock[] = [];
    for (let slot = 0; slot < 300; slot++) blocks.push(await seedHot(slot)); // > BLOCK_BATCH_SIZE (256)

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toHaveLength(300);
    expect((await db.executionPayloadEnvelopeArchive.get(0))?.selector).toBe(ArchivedEnvelopeKind.Blinded);
    expect((await db.executionPayloadEnvelopeArchive.get(299))?.selector).toBe(ArchivedEnvelopeKind.Blinded);
    expect(
      await db.executionPayloadEnvelope.get(generateSignedExecutionPayloadEnvelope(299).message.beaconBlockRoot)
    ).toBeNull();
  });

  it("skips EMPTY payload-status blocks and blocks missing from hot", async () => {
    const empty = await seedHot(10, PayloadStatus.EMPTY);
    const missing = generateProtoBlock({
      slot: 11,
      blockRoot: toRootHex(new Uint8Array(32).fill(0xff)),
      payloadStatus: PayloadStatus.FULL,
    });

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [empty, missing], true);

    expect(migrated).toEqual([]);
    expect(await db.executionPayloadEnvelopeArchive.get(10)).toBeNull();
    expect(await db.executionPayloadEnvelopeArchive.get(11)).toBeNull();
  });
});
