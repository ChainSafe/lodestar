import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {encodeKey} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {Bucket} from "../../../../src/db/buckets.js";
import {EarliestAvailableSlot} from "../../../../src/db/single/index.js";

describe("earliest available slot store", () => {
  let testDir: string;
  let db: LevelDbController;
  let store: EarliestAvailableSlot;

  beforeEach(async () => {
    testDir = await mkdtemp(join(process.cwd(), ".tmp_earliest_available_slot_"));
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    store = new EarliestAvailableSlot(config, db);
  });

  afterEach(async () => {
    await db.close();
    await rm(testDir, {recursive: true, force: true});
  });

  it("returns null when no slot is stored", async () => {
    expect(await store.get()).toBeNull();
  });

  it("stores slot zero", async () => {
    await store.put(0);

    expect(await store.get()).toBe(0);
  });

  it("replaces the slot without adding another record", async () => {
    await store.put(246560);
    await store.put(313312);

    expect(await store.get()).toBe(313312);
    expect(await db.keys()).toHaveLength(1);
  });

  it("retains the slot after reopening the database", async () => {
    await store.put(313312);
    await db.close();
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    store = new EarliestAvailableSlot(config, db);

    expect(await store.get()).toBe(313312);
  });

  it("deletes only the singleton record", async () => {
    const neighboringKey = encodeKey(Bucket.gloas_executionPayloadEnvelopeArchive, 123);
    const neighboringValue = new Uint8Array([1, 2, 3]);
    await db.put(neighboringKey, neighboringValue);
    await store.put(313312);

    await store.delete();

    expect(await store.get()).toBeNull();
    expect(await db.get(neighboringKey)).toEqual(Buffer.from(neighboringValue));
    expect(await db.keys()).toHaveLength(1);
  });
});
