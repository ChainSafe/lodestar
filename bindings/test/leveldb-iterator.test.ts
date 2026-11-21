import {expect, it} from "vitest";
import {LevelDb, type LevelDbEntry, type LevelDbIterator} from "../src/leveldb.js";
import {bytes, withDatabase as withLevelDb} from "./utils/leveldb.js";

const withDatabase = (run: (db: LevelDb, path: string) => Promise<void>): Promise<void> =>
  withLevelDb(run, {multithreading: true});

const key = (index: number): Uint8Array => bytes(index >>> 8, index & 255);
const indexOf = (entry: LevelDbEntry): number => entry.key[0] * 256 + entry.key[1];

async function nextIndex(iterator: LevelDbIterator): Promise<number | undefined> {
  const row = await iterator.next();
  return row.done ? undefined : indexOf(row.value);
}

async function seed(db: LevelDb, count: number): Promise<void> {
  await db.batch(Array.from({length: count}, (_, i) => ({key: key(i), type: "put", value: bytes(i & 255)})));
}

it("releases async iteration adapters returned or thrown before their first pull", async () => {
  await withDatabase(async (db) => {
    await seed(db, 1);
    const stopped = new Error("StoppedBeforePull");
    for (let index = 0; index < 65; index++) {
      const returned = db.iterator()[Symbol.asyncIterator]();
      expect(await returned.return?.()).toEqual({done: true, value: undefined});
      expect(await returned.next()).toEqual({done: true, value: undefined});
      const thrown = db.iterator()[Symbol.asyncIterator]();
      await expect(thrown.throw?.(stopped)).rejects.toBe(stopped);
    }
    const cursor = db.iterator();
    try {
      expect(await nextIndex(cursor)).toBe(0);
    } finally {
      await cursor.close();
    }
  });
});

it("reads one row first, refills 1000, and drains cached rows before a mixed nextv read", async () => {
  await withDatabase(async (db) => {
    await seed(db, 1205);
    const iterator = db.iterator();
    try {
      expect(await nextIndex(iterator)).toBe(0);
      expect(await nextIndex(iterator)).toBe(1);
      const cached = await iterator.nextv(5000);
      expect(cached).toHaveLength(999);
      expect(cached.map(indexOf)).toEqual(Array.from({length: 999}, (_, i) => i + 2));
      expect((await iterator.nextv(5000)).map(indexOf)).toEqual(Array.from({length: 204}, (_, i) => i + 1001));
      expect(await nextIndex(iterator)).toBeUndefined();
      iterator.seek(key(50));
      expect(await nextIndex(iterator)).toBe(50);
      expect((await iterator.nextv(5)).map(indexOf)).toEqual([51, 52, 53, 54, 55]);
    } finally {
      await iterator.close();
    }
  });
});

it("includes the row crossing the fixed 16 KiB soft watermark, including an oversized first row", async () => {
  await withDatabase(async (db) => {
    await db.batch(Array.from({length: 5}, (_, i) => ({key: key(i), type: "put", value: new Uint8Array(8190)})));
    const iterator = db.iterator();
    try {
      expect((await iterator.nextv(100)).map(indexOf)).toEqual([0, 1, 2]);
      expect((await iterator.nextv(100)).map(indexOf)).toEqual([3, 4]);
    } finally {
      await iterator.close();
    }
    await db.put(key(0), new Uint8Array(65 * 1024));
    const large = db.iterator();
    try {
      const first = await large.nextv(100);
      expect(first).toHaveLength(1);
      expect(first[0].value).toHaveLength(65 * 1024);
      expect((await large.nextv(100)).map(indexOf)).toEqual([1, 2, 3]);
      expect(await nextIndex(large)).toBe(4);
    } finally {
      await large.close();
    }
  });
});

it("charges only projected bytes against the watermark and preserves empty projections", async () => {
  await withDatabase(async (db) => {
    await db.batch(Array.from({length: 4}, (_, i) => ({key: key(i), type: "put", value: new Uint8Array(20_000)})));
    const keys = db.keys();
    try {
      expect(await keys.nextv(100)).toEqual([key(0), key(1), key(2), key(3)]);
      expect(await keys.nextv(100)).toEqual([]);
    } finally {
      await keys.close();
    }
    await db.clear();
    const largeKeys = Array.from({length: 5}, (_, i) => new Uint8Array(4096).fill(i));
    await db.batch(largeKeys.map((key, i) => ({key, type: "put", value: bytes(i)})));
    const values = db.values();
    try {
      expect(await values.nextv(100)).toEqual([bytes(0), bytes(1), bytes(2), bytes(3), bytes(4)]);
      expect(await values.nextv(100)).toEqual([]);
    } finally {
      await values.close();
    }
    const neither = db.iterator({keys: false, values: false});
    try {
      expect(await neither.nextv(2)).toEqual([
        {key: bytes(), value: bytes()},
        {key: bytes(), value: bytes()},
      ]);
      expect(await neither.nextv(10)).toHaveLength(3);
    } finally {
      await neither.close();
    }
  });
});

it("supports explicit bulk nextv above 1024 and validates its size", async () => {
  await withDatabase(async (db) => {
    await seed(db, 4097);
    const bulk = db.iterator();
    try {
      expect(await bulk.nextv(4097)).toHaveLength(4097);
      expect(await bulk.nextv(1)).toEqual([]);
    } finally {
      await bulk.close();
    }
    const iterator = db.iterator();
    try {
      expect((await iterator.nextv(0)).map(indexOf)).toEqual([0]);
      expect((await iterator.nextv(-10)).map(indexOf)).toEqual([1]);
      for (const invalid of [NaN, Infinity, 1.5, 16_777_217]) {
        await expect(iterator.nextv(invalid)).rejects.toThrow("InvalidLimit");
      }
      expect(await nextIndex(iterator)).toBe(2);
    } finally {
      await iterator.close();
    }
  });
});

it("seek discards the cache, copies targets immediately and preserves the original snapshot", async () => {
  await withDatabase(async (db) => {
    await seed(db, 20);
    const iterator = db.iterator();
    try {
      const target = key(5);
      iterator.seek(target);
      target.fill(255);
      await db.put(key(5), bytes(99));
      expect((await iterator.next()).value).toEqual({key: key(5), value: bytes(5)});
      expect(await nextIndex(iterator)).toBe(6);
      iterator.seek(key(2));
      expect(await nextIndex(iterator)).toBe(2);
      iterator.seek(key(100));
      expect(await nextIndex(iterator)).toBeUndefined();
      iterator.seek(key(5));
      expect((await iterator.next()).value).toEqual({key: key(5), value: bytes(5)});
      iterator.seek(key(7));
      iterator.seek(key(8));
      expect(await nextIndex(iterator)).toBe(8);
    } finally {
      await iterator.close();
    }
  });
});

it("seek honors inclusive precedence, exclusive ranges and absent targets in both directions", async () => {
  await withDatabase(async (db) => {
    for (const i of [1, 3, 5]) await db.put(key(i), bytes(i));
    for (const reverse of [false, true]) {
      const iterator = db.iterator({gt: key(0), gte: key(1), lt: key(4), lte: key(5), reverse});
      try {
        for (const [target, forward, backward] of [
          [0, undefined, undefined],
          [1, 1, 1],
          [2, 3, 1],
          [5, 5, 5],
          [6, undefined, undefined],
        ] as const) {
          iterator.seek(key(target));
          expect(await nextIndex(iterator)).toBe(reverse ? backward : forward);
        }
      } finally {
        await iterator.close();
      }
      const exclusive = db.iterator({gt: key(1), lt: key(5), reverse});
      try {
        for (const target of [1, 5]) {
          exclusive.seek(key(target));
          expect(await nextIndex(exclusive)).toBeUndefined();
        }
        exclusive.seek(key(3));
        expect(await nextIndex(exclusive)).toBe(3);
      } finally {
        await exclusive.close();
      }
    }
    const reverse = db.iterator({reverse: true});
    try {
      reverse.seek(key(100));
      expect(await nextIndex(reverse)).toBe(5);
    } finally {
      await reverse.close();
    }
  });
});

it("seek preserves consumed limits including discarded prefetched rows", async () => {
  await withDatabase(async (db) => {
    await seed(db, 10);
    const iterator = db.iterator({limit: 5});
    try {
      expect(await nextIndex(iterator)).toBe(0);
      expect(await nextIndex(iterator)).toBe(1);
      iterator.seek(key(0));
      expect(await nextIndex(iterator)).toBeUndefined();
      expect(await iterator.nextv(10)).toEqual([]);
    } finally {
      await iterator.close();
    }
    const single = db.iterator({limit: 3});
    try {
      for (let i = 0; i < 3; i++) {
        single.seek(key(2));
        expect(await nextIndex(single)).toBe(2);
      }
      single.seek(key(1));
      expect(await nextIndex(single)).toBeUndefined();
    } finally {
      await single.close();
    }
  });
});

it("rejects concurrent pulls and seek, validates copied seek bytes, and cancels queued positioning", async () => {
  await withDatabase(async (db) => {
    await seed(db, 3);
    const iterator = db.iterator();
    const pull = iterator.nextv(1);
    await expect(iterator.next()).rejects.toThrow("IteratorBusy");
    await expect(iterator.nextv(1)).rejects.toThrow("IteratorBusy");
    expect(() => iterator.seek(key(1))).toThrow("IteratorBusy");
    await pull;
    const detached = key(0);
    structuredClone(detached, {transfer: [detached.buffer]});
    for (const invalid of [detached, new Uint8Array(new SharedArrayBuffer(2)), new Int8Array(2)]) {
      expect(() => iterator.seek(invalid as Uint8Array)).toThrow("InvalidBytes");
    }
    expect(() => iterator.seek(new Uint8Array(4097))).toThrow("KeyTooLarge");
    expect(await nextIndex(iterator)).toBe(1);
    await iterator.close();
    iterator.seek(key(0));
    expect(await iterator.nextv(1)).toEqual([]);
    for (let i = 0; i < 65; i++) {
      const cancelled = db.iterator();
      cancelled.seek(key(1));
      const pending = cancelled.nextv(10);
      const closing = cancelled.close();
      expect(cancelled.close()).toBe(closing);
      expect(await pending).toEqual([]);
      await closing;
      expect(await cancelled.nextv(10)).toEqual([]);
    }
  });
});

it("for-await releases naturally exhausted cursors while manual exhaustion stays seekable", async () => {
  await withDatabase(async (db) => {
    await seed(db, 1);
    for (let i = 0; i < 65; i++) {
      const all: LevelDbEntry[] = [];
      for await (const entry of db.iterator()) all.push(entry);
      expect(all).toHaveLength(1);
    }
    const manual = db.iterator();
    try {
      expect(await nextIndex(manual)).toBe(0);
      expect(await nextIndex(manual)).toBeUndefined();
      manual.seek(key(0));
      expect(await nextIndex(manual)).toBe(0);
    } finally {
      await manual.close();
    }
  });
});

it("seekable snapshots survive shared-handle writes and another handle closing", async () => {
  await withDatabase(async (first, path) => {
    await seed(first, 4);
    const second = await LevelDb.open(path, {multithreading: true});
    try {
      const iterator = second.values({reverse: true});
      try {
        expect(await iterator.nextv(10)).toEqual([bytes(3), bytes(2), bytes(1), bytes(0)]);
        await first.put(key(2), bytes(99));
        await first.close();
        iterator.seek(key(2));
        expect((await iterator.next()).value).toEqual(bytes(2));
        expect(await iterator.nextv(10)).toEqual([bytes(1), bytes(0)]);
      } finally {
        await iterator.close();
      }
      expect(await second.get(key(2))).toEqual(bytes(99));
    } finally {
      await second.close();
    }
  });
});
