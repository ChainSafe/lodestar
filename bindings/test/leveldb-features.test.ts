import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {LevelDb, type LevelDbOperation} from "../src/leveldb.js";
import {bytes, collect, withDatabase} from "./utils/leveldb.js";

it("honors cache options and allocates only actual outputs", async () => {
  await withDatabase(async (db, path) => {
    const value = new Uint8Array(64 * 1024).fill(7);
    await db.put(bytes(1), value);
    expect(await db.get(bytes(2))).toBeNull();
    expect(await db.getMany([])).toEqual([]);
    for (const fillCache of [false, true]) {
      expect(await db.get(bytes(1), {fillCache})).toEqual(value);
      expect(await db.getMany([bytes(1), bytes(2)], {fillCache})).toEqual([value, null]);
    }
    await db.close();
    const constrained = await LevelDb.open(path, {maxPendingBytes: 4096});
    try {
      const [first, second] = await Promise.all([constrained.get(bytes(1)), constrained.get(bytes(1))]);
      expect(first).toEqual(value);
      expect(second).toEqual(value);
      const cursor = constrained.values();
      expect(await collect(cursor)).toEqual([value]);
    } finally {
      await constrained.close();
    }
  });
});

it("implements exclusive and inclusive bounds in both directions with inclusive precedence", async () => {
  await withDatabase(async (db) => {
    await db.batch(Array.from({length: 6}, (_, index) => ({key: bytes(index), type: "put", value: bytes(index)})));
    expect(await collect(db.keys({gt: bytes(1), lt: bytes(4)}))).toEqual([bytes(2), bytes(3)]);
    expect(await collect(db.keys({gte: bytes(1), lte: bytes(4), reverse: true}))).toEqual([
      bytes(4),
      bytes(3),
      bytes(2),
      bytes(1),
    ]);
    expect(await collect(db.keys({gt: bytes(1), lt: bytes(4), reverse: true}))).toEqual([bytes(3), bytes(2)]);
    expect(await collect(db.keys({gte: bytes(2, 0), limit: 1, lte: bytes(4), reverse: true}))).toEqual([bytes(4)]);
    expect(await collect(db.keys({lte: bytes(2, 0), reverse: true}))).toEqual([bytes(2), bytes(1), bytes(0)]);
    expect(await collect(db.keys({gt: bytes(4), gte: bytes(1), lt: bytes(2), lte: bytes(3)}))).toEqual([
      bytes(1),
      bytes(2),
      bytes(3),
    ]);
    expect(await collect(db.keys({gte: bytes(4), lte: bytes(2), reverse: true}))).toEqual([]);
    expect(await collect(db.keys({gt: bytes(255), reverse: true}))).toEqual([]);
    expect(await collect(db.values({limit: 0, reverse: true}))).toEqual([]);
  });
});

it("returns the selected key and value projections", async () => {
  await withDatabase(async (db) => {
    const largeValue = new Uint8Array(64 * 1024).fill(9);
    const largeKey = new Uint8Array(4096).fill(255);
    await db.batch([
      {key: bytes(1), type: "put", value: largeValue},
      {key: largeKey, type: "put", value: bytes(3)},
    ]);
    expect(await collect(db.keys({fillCache: true, lt: bytes(2)}))).toEqual([bytes(1)]);
    expect(await collect(db.values({fillCache: false, gte: largeKey}))).toEqual([bytes(3)]);
    expect(await collect(db.iterator({lt: bytes(2), values: false}))).toEqual([{key: bytes(1), value: bytes()}]);
    expect(await collect(db.iterator({gte: largeKey, keys: false}))).toEqual([{key: bytes(), value: bytes(3)}]);
    expect(await collect(db.iterator({keys: false, values: false}))).toEqual([
      {key: bytes(), value: bytes()},
      {key: bytes(), value: bytes()},
    ]);
  });
});

it("keeps reverse snapshots and copied bounds stable while clear and later writes are queued", async () => {
  await withDatabase(async (db) => {
    await db.batch([
      {key: bytes(1), type: "put", value: bytes(11)},
      {key: bytes(2), type: "put", value: bytes(22)},
    ]);
    const gte = bytes(1);
    const lte = bytes(2);
    const snapshot = db.iterator({gte, lte, reverse: true});
    gte.fill(9);
    lte.fill(0);
    const before = db.put(bytes(3), bytes(33));
    const clearing = db.clear();
    const after = db.put(bytes(4), bytes(44));
    await Promise.all([before, clearing, after]);
    expect(await collect(snapshot)).toEqual([
      {key: bytes(2), value: bytes(22)},
      {key: bytes(1), value: bytes(11)},
    ]);
    expect(await collect(db.keys())).toEqual([bytes(4)]);
    expect(await collect(db.values())).toEqual([bytes(44)]);
    await db.clear();
    await db.clear();
    expect(await db.getMany([bytes(1), bytes(2), bytes(3), bytes(4)])).toEqual([null, null, null, null]);
  });
});

it("handles bulk reads and atomic batches above 1024 entries", async () => {
  await withDatabase(async (db) => {
    const operations: LevelDbOperation[] = Array.from({length: 4097}, (_, index) => ({
      key: bytes(index >>> 8, index & 255),
      type: "put",
      value: bytes(index & 255),
    }));
    await db.batch(operations);
    const keys = operations.map(({key}) => key);
    expect(await db.getMany(keys)).toEqual(keys.map((key) => bytes(key[1])));
    await expect(
      db.batch([
        {key: bytes(255, 255), type: "put", value: bytes(9)},
        ...keys.map((key): LevelDbOperation => ({key, type: "del"})),
        {key: new Uint8Array(4097), type: "del"},
      ])
    ).rejects.toThrow("KeyTooLarge");
    expect(await db.get(bytes(255, 255))).toBeNull();
    expect(await db.getMany(keys)).toEqual(keys.map((key) => bytes(key[1])));
    await db.clear();
    expect(await db.getMany(keys)).toEqual(new Array(4097).fill(null));
  });
}, 30_000);

it("runs diagnostic, size, compaction, and destruction operations with reusable ownership", async () => {
  await withDatabase(async (db, path) => {
    await db.put(bytes(1), new Uint8Array(4096).fill(7), {sync: true});
    expect(await db.getProperty("leveldb.stats")).toContain("Compactions");
    expect(await db.getProperty("unknown-property")).toBeNull();
    const before = await db.approximateSize(bytes(), bytes(255));
    expect(Number.isSafeInteger(before)).toBe(true);
    expect(before).toBeGreaterThanOrEqual(0);
    await db.compactRange(bytes(), bytes(255));
    const after = await db.approximateSize(bytes(), bytes(255));
    expect(Number.isSafeInteger(after)).toBe(true);
    expect(after).toBeGreaterThan(0);
    await db.close();
    await expect(db.clear()).rejects.toThrow("DatabaseClosed");
    await expect(db.getProperty("leveldb.stats")).rejects.toThrow("DatabaseClosed");
    await expect(db.approximateSize(bytes(), bytes(255))).rejects.toThrow("DatabaseClosed");
    await expect(db.compactRange(bytes(), bytes(255))).rejects.toThrow("DatabaseClosed");
    await expect(LevelDb.destroy("")).rejects.toThrow("InvalidPath");
    await LevelDb.destroy(path);
    await LevelDb.destroy(path);
    await expect(LevelDb.open(path, {createIfMissing: false})).rejects.toMatchObject({code: "InvalidArgument"});
    const recreated = await LevelDb.open(path);
    try {
      expect(await recreated.get(bytes(1))).toBeNull();
    } finally {
      await recreated.close();
    }
  });
});

it("closes projected iterators before first pull and rejects malformed cache options", async () => {
  await withDatabase(async (db) => {
    await db.put(bytes(1), bytes(2));
    for (const cursor of [db.keys(), db.values()]) {
      const closing = cursor.close();
      expect(cursor.close()).toBe(closing);
      await closing;
      expect(await cursor.next()).toEqual({done: true, value: undefined});
    }
    const fillCache = "yes" as unknown as boolean;
    await expect(db.get(bytes(1), {fillCache})).rejects.toThrow("InvalidOptions");
    await expect(db.getMany([bytes(1)], {fillCache})).rejects.toThrow("InvalidOptions");
    const invalid = db.keys({fillCache});
    await expect(invalid.next()).rejects.toThrow("InvalidOptions");
    await invalid.close();
    expect(await db.get(bytes(1))).toEqual(bytes(2));
  });
});

it("accepts a 600-operation archive burst with reads after awaited writes", async () => {
  await withDatabase(async (db) => {
    const keys = Array.from({length: 600}, (_, index) => bytes(index >>> 8, index & 255));
    const writes = keys.map((key) => db.put(key, key));
    await Promise.all(writes);
    expect(await Promise.all(keys.map((key) => db.get(key)))).toEqual(keys);
  });
});

it("persists and reads an archived-state-sized value above 64 MiB", async () => {
  await withDatabase(async (db, path) => {
    const value = new Uint8Array(65 * 1024 * 1024).fill(17);
    value[0] = 1;
    value[value.length - 1] = 255;
    const expected = createHash("sha256").update(value).digest("hex");
    await db.put(bytes(1), value, {sync: true});
    expect(await collect(db.keys())).toEqual([bytes(1)]);
    await db.close();
    const reopened = await LevelDb.open(path);
    try {
      const actual = await reopened.get(bytes(1));
      expect(actual?.length).toBe(value.length);
      if (actual === null) throw new Error("Archived state was not persisted");
      expect(createHash("sha256").update(actual).digest("hex")).toBe(expected);
      const cursor = reopened.values();
      try {
        const row = await cursor.next();
        expect(row.done).toBe(false);
        if (row.done) throw new Error("Archived state was not returned by the cursor");
        expect(createHash("sha256").update(row.value).digest("hex")).toBe(expected);
        expect((await cursor.next()).done).toBe(true);
      } finally {
        await cursor.close();
      }
    } finally {
      await reopened.close();
    }
  });
}, 30_000);

it("keeps concurrent multi-gets consistent while atomic batches replace their keys", async () => {
  await withDatabase(async (db) => {
    const keys = Array.from({length: 32}, (_, index) => bytes(index));
    await db.batch(keys.map((key) => ({key, type: "put", value: bytes(0)})));
    const writes = Array.from({length: 32}, (_, index) =>
      db.batch(keys.map((key) => ({key, type: "put", value: bytes(index + 1)})))
    );
    const reads = Array.from({length: 32}, () => db.getMany(keys));
    const results = await Promise.all(reads);
    for (const [index, values] of results.entries()) {
      expect(values[0], `read ${index} has a committed value`).not.toBeNull();
      expect(values, `read ${index} observes one atomic batch`).toEqual(keys.map(() => values[0]));
    }
    await Promise.all(writes);
    expect(await db.getMany(keys)).toEqual(keys.map(() => bytes(32)));
  });
});

it("drains concurrent reads and serialized writes before close", async () => {
  await withDatabase(async (db, path) => {
    const value = new Uint8Array(1024 * 1024).fill(7);
    await db.put(bytes(1), value);
    const reads = Array.from({length: 16}, () => db.get(bytes(1)));
    const writes = Array.from({length: 16}, (_, index) => db.put(bytes(2), bytes(index)));
    const closing = db.close();
    const results = await Promise.all(reads);
    for (const [index, result] of results.entries()) {
      expect(result?.length, `read ${index} length`).toBe(value.length);
      expect(
        result?.every((byte) => byte === 7),
        `read ${index} contents`
      ).toBe(true);
    }
    await Promise.all(writes);
    await closing;
    const reopened = await LevelDb.open(path);
    try {
      expect(await reopened.get(bytes(2))).toEqual(bytes(15));
    } finally {
      await reopened.close();
    }
  });
});
