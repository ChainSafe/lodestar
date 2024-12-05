import all from "it-all";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {SqliteController} from "#controller/sqlite";
import {getEnvLogger} from "@lodestar/logger/env";

describe("sqlite controller", () => {
  const dbLocation = ":memory:";
  const bucketId = "test";
  let db: SqliteController;

  beforeAll(async () => {
    db = SqliteController.create({name: dbLocation}, {metrics: null, logger: getEnvLogger()});
    db.createTables([bucketId]);
  });

  afterAll(async () => {
    await db.close();
  });

  it("test get not found", async () => {
    const key = Buffer.from("not-existing-key");
    expect(await db.get(key, {bucketId})).toBe(null);
  });

  it("test put/get/delete", async () => {
    const key = Buffer.from("test");
    const value = new Uint8Array(Buffer.from("some value"));
    await db.put(key, value, {bucketId});
    expect(await db.get(key, {bucketId})).toEqual(value);
    await db.delete(key, {bucketId});
    expect(await db.get(key, {bucketId})).toBe(null);
  });

  it("test batchPut", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut(
      [
        {
          key: k1,
          value: Buffer.from("value"),
        },
        {
          key: k2,
          value: Buffer.from("value"),
        },
      ],
      {bucketId}
    );
    expect(await db.get(k1, {bucketId})).not.toBeNull();
    expect(await db.get(k2, {bucketId})).not.toBeNull();
  });

  it("test batch delete", async () => {
    await db.batchDelete(await db.keys({bucketId}), {bucketId});
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut(
      [
        {
          key: k1,
          value: Buffer.from("value"),
        },
        {
          key: k2,
          value: Buffer.from("value"),
        },
      ],
      {bucketId}
    );
    expect((await db.entries({bucketId})).length).toBe(2);
    await db.batchDelete([k1, k2], {bucketId});
    expect((await db.entries({bucketId})).length).toBe(0);
  });

  it("test entries", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut(
      [
        {
          key: k1,
          value: Buffer.from("value"),
        },
        {
          key: k2,
          value: Buffer.from("value"),
        },
      ],
      {bucketId}
    );
    const result = await db.entries({
      gte: k1,
      lte: k2,
      bucketId,
    });
    expect(result.length).toBe(2);
  });

  it("test entriesStream", async () => {
    const k1 = Buffer.from("test3");
    const k2 = Buffer.from("test4");
    await db.batchPut(
      [
        {
          key: k1,
          value: Buffer.from("value"),
        },
        {
          key: k2,
          value: Buffer.from("value"),
        },
      ],
      {bucketId}
    );
    const resultStream = db.entriesStream({
      gte: k1,
      lte: k2,
      reverse: true,
      bucketId,
    });
    const result = await all(resultStream);
    expect(result.length).toBe(2);

    const resultStream2 = db.entriesStream({
      gte: k1,
      lte: k2,
      reverse: true,
      bucketId,
    });
    const result2 = await all(resultStream2);
    expect(result2.length).toBe(2);
  });
});
