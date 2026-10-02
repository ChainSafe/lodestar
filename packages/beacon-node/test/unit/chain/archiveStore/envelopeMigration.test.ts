import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {migrateExecutionPayloadEnvelopesFromHotToColdDb} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {ArchivedEnvelope, decodeArchivedEnvelope} from "../../../../src/db/repositories/index.js";
import {toSignedHeaderEnvelope} from "../../../../src/util/headerEnvelope.js";
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

  async function readArchived(slot: number): Promise<ArchivedEnvelope> {
    const bytes = await db.executionPayloadEnvelopeArchive.getBinary(slot);
    if (bytes === null) throw Error(`no archived entry at slot ${slot}`);
    return decodeArchivedEnvelope(bytes);
  }

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

  it("archives header envelopes by default (dedupePayloads=true) and removes them from hot", async () => {
    const blocks = [await seedHot(10), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    for (const slot of [10, 11]) {
      const archived = await readArchived(slot);
      if (archived.headerEnvelope === undefined) throw Error("expected a header entry");
      expect(
        ssz.gloas.SignedExecutionPayloadHeaderEnvelope.equals(
          archived.headerEnvelope,
          toSignedHeaderEnvelope(generateSignedExecutionPayloadEnvelope(slot))
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

    const archived = await readArchived(10);
    if (archived.envelopeBytes === undefined) throw Error("expected a full entry");
    expect(Uint8Array.from(archived.envelopeBytes)).toEqual(
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(generateSignedExecutionPayloadEnvelope(10))
    );
    expect(
      await db.executionPayloadEnvelope.get(generateSignedExecutionPayloadEnvelope(10).message.beaconBlockRoot)
    ).toBeNull();
  });

  it("serves a mixed archive through the union: both forms round-trip from the same bucket", async () => {
    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [await seedHot(10)], true);
    await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, [await seedHot(11)], false);

    expect((await readArchived(10)).headerEnvelope).toBeDefined();
    expect((await readArchived(11)).envelopeBytes).toBeDefined();
  });

  it("archives in full when the block is not yet execution-valid, even with dedupePayloads=true", async () => {
    // Optimistic import: the EL has not validated this payload, so it may not serve its bodies later
    const blocks = [await seedHot(10, PayloadStatus.FULL, ExecutionStatus.Syncing), await seedHot(11)];

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toEqual([10, 11]);
    expect((await readArchived(10)).envelopeBytes).toBeDefined();
    expect((await readArchived(11)).headerEnvelope).toBeDefined();
  });

  it("migrates more blocks than one batch, in one atomic write per batch", async () => {
    const blocks: ProtoBlock[] = [];
    for (let slot = 0; slot < 300; slot++) blocks.push(await seedHot(slot)); // > BLOCK_BATCH_SIZE (256)

    const migrated = await migrateExecutionPayloadEnvelopesFromHotToColdDb(config, db, logger, blocks, true);

    expect(migrated).toHaveLength(300);
    expect((await readArchived(0)).headerEnvelope).toBeDefined();
    expect((await readArchived(299)).headerEnvelope).toBeDefined();
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
    expect(await db.executionPayloadEnvelopeArchive.getBinary(10)).toBeNull();
    expect(await db.executionPayloadEnvelopeArchive.getBinary(11)).toBeNull();
  });
});
