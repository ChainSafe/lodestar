import {mkdtemp, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ClassicLevel, type IteratorOptions} from "classic-level";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {DB_READ_LIMITS_V1, DbReadLimits, LevelDbController} from "../../../src/index.js";

type NativeStats = {
  liveArenaBytes: number;
  peakArenaBytes: number;
  copiedKeyBytes: number;
  copiedValueBytes: number;
  allocatedKeyBytes: number;
  allocatedValueBytes: number;
  convertedValues: number;
  liveWorkerRefs: number;
  liveAsyncWorks: number;
  liveSnapshots: number;
  workerFailureCallbacks: number;
  inputCopyCalls: number;
  inputCopyBytes: number;
  nullInputCopyOperands: number;
  emptyInputCopiesSkipped: number;
};
const require = createRequire(import.meta.url);
const native = require(require.resolve("classic-level").replace(/index.js$/, "binding.js")) as {
  iterator_nextv: (
    context: unknown,
    size: number,
    callback: (error: Error | null, rows: [Buffer, Buffer][]) => void
  ) => void;
  iterator_close: (context: unknown, callback: (error?: Error) => void) => void;
  bounded_test_stats?: (failAfter?: number, workerFault?: number) => NativeStats;
};
const instrumented = process.env.CLASSIC_LEVEL_BOUNDED_INSTRUMENTED === "1";

describe("bounded LevelDB controller", () => {
  let directory: string;
  let db: LevelDbController;
  let storage: ClassicLevel<Uint8Array, Uint8Array>;
  const readLimits: DbReadLimits = {maxKeyBytes: 32, maxValueBytes: 8, maxTotalBytes: 24, maxEntries: 4};
  const options = (overrides: Partial<DbReadLimits> = {}) => ({readLimits: {...readLimits, ...overrides}});
  function rangeIterator(mode: "iterator" | "keys" | "values", range: IteratorOptions<Uint8Array, Uint8Array>) {
    if (mode === "keys") return storage.keys(range);
    if (mode === "values") return storage.values(range);
    return storage.iterator(range);
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-level-bounds-"));
    storage = new ClassicLevel(join(directory, "db"), {keyEncoding: "binary", valueEncoding: "binary"});
    db = await LevelDbController.create(
      {name: join(directory, "db"), db: storage},
      {metrics: null, logger: getEnvLogger()}
    );
  });
  afterEach(async () => {
    try {
      await db?.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
  it("refuses an eight-byte value before a seven-byte bounded read", async () => {
    const key = Uint8Array.of(1);
    const value = new Uint8Array(8).fill(0x5a);
    const options = {
      bucketId: "bounded-read-test",
      readLimits: {maxKeyBytes: 32, maxValueBytes: 7, maxTotalBytes: 7, maxEntries: 1},
    };
    await db.put(key, value);
    expect(await db.get(key)).toEqual(Buffer.from(value));
    await expect(db.get(key, options)).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
  }, 10000);
  it("reports the actual native bounded capability", () => {
    expect(db).toHaveProperty("boundedReadVersion", 1);
  });
  it("accepts exact value size and keeps ordinary missing representations", async () => {
    await db.put(Buffer.from([1]), Buffer.alloc(8, 0x5a));
    expect(await db.get(Buffer.from([1]), options({maxEntries: 1, maxTotalBytes: 8}))).toEqual(Buffer.alloc(8, 0x5a));
    expect(await db.get(Buffer.from([2]), options({maxEntries: 1}))).toBeNull();
    expect(await db.getMany([Buffer.from([2])], options())).toEqual([undefined]);
    expect(await db.getMany([], options())).toEqual([]);
    expect(await db.getMany([Buffer.from([2]), Buffer.from([3])], options())).toEqual([undefined, undefined]);
  });

  it("counts duplicates in exact cumulative limits and preserves requested positions", async () => {
    const a = Buffer.from([1]),
      b = Buffer.from([2]),
      missing = Buffer.from([3]);
    const av = Buffer.alloc(4, 1),
      bv = Buffer.alloc(4, 2);
    await db.batchPut([
      {key: a, value: av},
      {key: b, value: bv},
    ]);
    expect(await db.getMany([b, missing, a, b], options({maxTotalBytes: 12}))).toEqual([bv, undefined, av, bv]);
    await expect(db.getMany([b, a, b], options({maxTotalBytes: 11}))).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
    expect(await db.getMany([a, b])).toEqual([av, bv]);
  });

  it("enforces key and entry caps at exact boundaries", async () => {
    const key = Buffer.alloc(32, 1),
      value = Buffer.from([7]);
    await db.put(key, value);
    expect(await db.get(key, options({maxEntries: 1}))).toEqual(value);
    await expect(db.get(key, options({maxKeyBytes: 31, maxEntries: 1}))).rejects.toMatchObject({
      code: "LEVEL_READ_LIMIT",
    });
    expect(await db.getMany([key, key], options({maxEntries: 2}))).toEqual([value, value]);
    await expect(db.getMany([key, key], options({maxEntries: 1}))).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
  });

  for (const field of ["maxKeyBytes", "maxValueBytes", "maxTotalBytes", "maxEntries"] as const) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      it(`rejects invalid ${field}=${value}`, async () => {
        await expect(db.getMany([], options({[field]: value}))).rejects.toMatchObject({
          code: "LEVEL_INVALID_READ_LIMITS",
        });
      });
    }
    it(`enforces the native ${field} hard ceiling`, async () => {
      expect(await db.getMany([], options({[field]: DB_READ_LIMITS_V1[field]}))).toEqual([]);
      await expect(db.getMany([], options({[field]: DB_READ_LIMITS_V1[field] + 1}))).rejects.toMatchObject({
        code: "LEVEL_INVALID_READ_LIMITS",
      });
    });
  }

  it("rejects malformed limits, sparse keys and detached buffers", async () => {
    for (const invalid of [null, {}, {maxKeyBytes: "32"}]) {
      await expect(db.getMany([], {readLimits: invalid as unknown as DbReadLimits})).rejects.toMatchObject({
        code: "LEVEL_INVALID_READ_LIMITS",
      });
    }
    await expect(db.getMany(new Array<Uint8Array>(2), options())).rejects.toMatchObject({
      code: "LEVEL_INVALID_READ_LIMITS",
    });
    await expect(db.getMany(["key" as unknown as Uint8Array], options())).rejects.toMatchObject({
      code: "LEVEL_INVALID_READ_LIMITS",
    });
    const detached = new Uint8Array(4);
    structuredClone(detached.buffer, {transfer: [detached.buffer]});
    await expect(db.getMany([detached], options())).rejects.toMatchObject({code: "LEVEL_INVALID_READ_LIMITS"});
    await expect(db.get(detached, options({maxEntries: 1}))).rejects.toMatchObject({code: "LEVEL_INVALID_READ_LIMITS"});
    expect(() => db.entriesStream({...options(), gte: detached, limit: 1})).toThrow(
      expect.objectContaining({code: "LEVEL_INVALID_READ_LIMITS"})
    );
    const changed = new Uint8Array(4);
    const keys = [changed, Buffer.from([2])];
    Object.defineProperty(keys, 1, {
      get() {
        structuredClone(changed.buffer, {transfer: [changed.buffer]});
        return Buffer.from([2]);
      },
    });
    await expect(db.getMany(keys, options())).rejects.toMatchObject({code: "LEVEL_INVALID_READ_LIMITS"});
  });

  it("captures the complete bounded batch snapshot at submission", async () => {
    const a = Buffer.from([1]),
      b = Buffer.from([2]);
    const av = Buffer.alloc(4, 1),
      bv = Buffer.alloc(4, 2),
      newer = Buffer.alloc(4, 3);
    await db.batchPut([
      {key: a, value: av},
      {key: b, value: bv},
    ]);
    const read = db.getMany([b, a, b], options());
    const write = db.batch([
      {type: "del", key: b},
      {type: "put", key: a, value: newer},
    ]);
    const [before] = await Promise.all([read, write]);
    expect(before).toEqual([bv, av, bv]);
    expect(await db.getMany([b, a, b], options())).toEqual([undefined, newer, undefined]);
  });

  it("keeps one iterator snapshot across one-row refills and writes", async () => {
    const rows = [1, 2, 3].map((n) => ({key: Buffer.from([n]), value: Buffer.alloc(4, n)}));
    await db.batchPut(rows);
    const iterator = db.entriesStream({...options({maxEntries: 1}), limit: 3})[Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).value).toEqual(rows[0]);
      await db.batch([
        {type: "del", key: rows[1].key},
        {type: "put", key: rows[2].key, value: Buffer.from([9])},
      ]);
      expect((await iterator.next()).value).toEqual(rows[1]);
      expect((await iterator.next()).value).toEqual(rows[2]);
      expect((await iterator.next()).done).toBe(true);
    } finally {
      await iterator.return?.();
    }
    expect(await db.entries()).toEqual([rows[0], {key: rows[2].key, value: Buffer.from([9])}]);
  });

  it("rejects oversized iterator values and permits a fresh healthy read", async () => {
    await db.batchPut([
      {key: Buffer.from([1]), value: Buffer.alloc(9)},
      {key: Buffer.from([2]), value: Buffer.alloc(4)},
    ]);
    await expect(Array.fromAsync(db.entriesStream({...options({maxEntries: 1}), limit: 2}))).rejects.toMatchObject({
      code: "LEVEL_READ_LIMIT",
    });
    expect(await db.get(Buffer.from([2]), options({maxEntries: 1}))).toEqual(Buffer.alloc(4));
  });

  it("bounds raw refills and cumulative returned values", async () => {
    await db.batchPut([1, 2].map((n) => ({key: Buffer.from([n]), value: Buffer.alloc(4, n)})));
    const iterator = storage.iterator({...options({maxEntries: 2, maxTotalBytes: 7}), limit: 2});
    try {
      await expect(iterator.nextv(2)).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
    } finally {
      await iterator.close();
    }
    const exact = storage.iterator({...options({maxEntries: 2, maxTotalBytes: 8}), limit: 2});
    try {
      expect(await exact.nextv(2)).toEqual([
        [Buffer.from([1]), Buffer.alloc(4, 1)],
        [Buffer.from([2]), Buffer.alloc(4, 2)],
      ]);
    } finally {
      await exact.close();
    }
  });

  it("preserves finite zero-row ranges and validates finite forward ranges", async () => {
    expect(await db.entries({limit: 0})).toEqual([]);
    expect(await db.entries({...options({maxEntries: 1}), limit: 0})).toEqual([]);
    expect(await db.entries({...options({maxEntries: 1}), limit: DB_READ_LIMITS_V1.maxIteratorRows})).toEqual([]);
    for (const limit of [undefined, -1, 1.5, Infinity, DB_READ_LIMITS_V1.maxIteratorRows + 1]) {
      expect(() => db.entriesStream({...options(), limit})).toThrow(
        expect.objectContaining({code: "LEVEL_INVALID_READ_LIMITS"})
      );
    }
    expect(() => db.entriesStream({...options(), limit: 2, reverse: true})).toThrow(
      expect.objectContaining({code: "LEVEL_INVALID_READ_LIMITS"})
    );
  });

  it("supports ordinary and bounded keys, values and early stream return", async () => {
    await db.batchPut([1, 2].map((n) => ({key: Buffer.from([n]), value: Buffer.alloc(4, n)})));
    expect(await db.keys({...options({maxEntries: 1}), limit: 2})).toEqual(await db.keys());
    expect(await db.values({...options({maxEntries: 1}), limit: 2})).toEqual(await db.values());
    const iterator = db.entriesStream({...options({maxEntries: 1}), limit: 2})[Symbol.asyncIterator]();
    const pending = iterator.next();
    const returned = iterator.return?.();
    await Promise.all([pending, returned]);
    expect((await iterator.next()).done).toBe(true);
  });

  it("rejects incompatible encodings and stale native capability", async () => {
    await expect(
      storage.get(Buffer.from([1]), {...options({maxEntries: 1}), valueEncoding: "utf8"})
    ).rejects.toMatchObject({code: "LEVEL_INVALID_READ_LIMITS"});
    Object.defineProperty(storage, "boundedReadVersion", {value: 0});
    expect(db.boundedReadVersion).toBeUndefined();
    await expect(db.get(Buffer.from([1]), options({maxEntries: 1}))).rejects.toMatchObject({
      code: "LEVEL_BOUNDED_READ_UNSUPPORTED",
    });
    expect(() => db.entriesStream({...options(), limit: 2})).toThrow(
      expect.objectContaining({code: "LEVEL_BOUNDED_READ_UNSUPPORTED"})
    );
    expect(await db.get(Buffer.from([1]))).toBeNull();
  });

  it("awaits bounded reads before closing the database", async () => {
    await db.put(Buffer.from([1]), Buffer.alloc(8));
    const read = db.getMany([Buffer.from([1])], options());
    const close = db.close();
    expect((await Promise.all([read, close]))[0]).toEqual([Buffer.alloc(8)]);
    await expect(db.getMany([Buffer.from([1])], options())).rejects.toMatchObject({code: "LEVEL_DATABASE_NOT_OPEN"});
  });

  it.skipIf(!instrumented)("proves native pre-copy refusal and exact staging retirement", async () => {
    const stats = native.bounded_test_stats;
    expect(stats).toBeTypeOf("function");
    if (!stats) throw new Error("Missing bounded test instrumentation");
    await db.put(Buffer.from([1]), Buffer.alloc(8));
    stats(-1);
    await expect(db.get(Buffer.from([1]), options({maxEntries: 1, maxValueBytes: 7}))).rejects.toMatchObject({
      code: "LEVEL_READ_LIMIT",
    });
    expect(stats()).toMatchObject({liveArenaBytes: 0, copiedValueBytes: 0, allocatedValueBytes: 0, peakArenaBytes: 1});
    console.log("refused-value", stats());
    await db.put(Buffer.from([1]), Buffer.alloc(4));
    stats(-1);
    expect(
      await db.getMany([Buffer.from([1]), Buffer.from([1]), Buffer.from([1])], options({maxTotalBytes: 12}))
    ).toEqual([Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)]);
    expect(stats()).toMatchObject({
      liveArenaBytes: 0,
      peakArenaBytes: 15,
      copiedKeyBytes: 3,
      copiedValueBytes: 12,
      allocatedValueBytes: 12,
      convertedValues: 3,
    });
    console.log("exact-duplicate-batch", stats());
    stats(-1);
    expect(await db.getMany([Buffer.from([8])], options())).toEqual([undefined]);
    expect(stats()).toMatchObject({liveArenaBytes: 0, allocatedValueBytes: 0, copiedValueBytes: 0});
    console.log("all-missing", stats());
    stats(-1);
    expect(await db.getMany([], options())).toEqual([]);
    expect(stats()).toMatchObject({liveArenaBytes: 0, peakArenaBytes: 0, allocatedKeyBytes: 0, allocatedValueBytes: 0});
  });

  it.skipIf(!instrumented)("clears staging after a partial JS conversion and explicit iterator close", async () => {
    const stats = native.bounded_test_stats;
    if (!stats) throw new Error("Missing bounded test instrumentation");
    await db.batchPut([1, 2].map((n) => ({key: Buffer.from([n]), value: Buffer.alloc(4, n)})));
    stats(1);
    await expect(db.getMany([Buffer.from([1]), Buffer.from([2])], options())).rejects.toMatchObject({
      code: "LEVEL_ALLOCATION_FAILED",
    });
    expect(stats()).toMatchObject({liveArenaBytes: 0, peakArenaBytes: 10, convertedValues: 1});
    console.log("partial-batch-conversion", stats());
    stats(1);
    const failed = storage.iterator({...options({maxEntries: 1, maxTotalBytes: 4}), limit: 2});
    try {
      await expect(failed.nextv(1)).rejects.toMatchObject({code: "LEVEL_ALLOCATION_FAILED"});
    } finally {
      await failed.close();
    }
    expect(stats()).toMatchObject({liveArenaBytes: 0, peakArenaBytes: 36, convertedValues: 1});
    console.log("partial-iterator-conversion-close", stats());
    stats(-1);
    const healthy = storage.iterator({...options({maxEntries: 1, maxTotalBytes: 4}), limit: 2});
    try {
      expect(await healthy.nextv(1)).toEqual([[Buffer.from([1]), Buffer.alloc(4, 1)]]);
      expect(stats()).toMatchObject({liveArenaBytes: 0, peakArenaBytes: 36});
    } finally {
      await healthy.close();
    }
    expect(stats().liveArenaBytes).toBe(0);
    console.log("healthy-iterator-close-before-gc", stats());
  });

  it("preserves empty keys and values while rejecting shared-backed inputs", async () => {
    const key = new Uint8Array(0);
    await db.put(key, new Uint8Array(0));
    expect(await db.get(key)).toEqual(Buffer.alloc(0));
    expect(await db.get(key, options({maxEntries: 1}))).toEqual(Buffer.alloc(0));
    expect(await db.getMany([key, key], options())).toEqual([Buffer.alloc(0), Buffer.alloc(0)]);
    expect(await db.entries({...options({maxEntries: 1}), gte: key, limit: 1})).toEqual([
      {key: Buffer.alloc(0), value: Buffer.alloc(0)},
    ]);
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    await expect(db.get(shared, options({maxEntries: 1}))).rejects.toMatchObject({code: "LEVEL_INVALID_READ_LIMITS"});
    await expect(db.getMany([shared], options())).rejects.toMatchObject({code: "LEVEL_INVALID_READ_LIMITS"});
    expect(() => db.entriesStream({...options(), gte: shared, limit: 1})).toThrow(
      expect.objectContaining({code: "LEVEL_INVALID_READ_LIMITS"})
    );
  });

  for (const fault of [1, 2, 3]) {
    it.skipIf(!instrumented)(`retires bounded iterator setup or queue failure ${fault}`, async () => {
      const stats = native.bounded_test_stats;
      if (!stats) throw new Error("Missing bounded test instrumentation");
      await db.put(Buffer.from([1]), Buffer.alloc(4));
      const iterator = storage.iterator({...options({maxEntries: 1}), limit: 2});
      try {
        stats(-1, fault);
        await expect(iterator.nextv(1)).rejects.toMatchObject({code: "LEVEL_ALLOCATION_FAILED"});
        expect(stats()).toMatchObject({liveArenaBytes: 0, liveWorkerRefs: 0, liveAsyncWorks: 0, copiedValueBytes: 0});
        expect(await iterator.nextv(1)).toEqual([[Buffer.from([1]), Buffer.alloc(4)]]);
        stats(-1, fault);
        await expect(iterator.close()).resolves.toBeUndefined();
        expect(stats()).toMatchObject({
          liveArenaBytes: 0,
          liveWorkerRefs: 0,
          liveAsyncWorks: 0,
          liveSnapshots: 0,
          workerFailureCallbacks: 1,
        });
        console.log(`retired-worker-fault-${fault}`, stats());
      } finally {
        await iterator.close();
      }
      expect(await db.get(Buffer.from([1]))).toEqual(Buffer.alloc(4));
    });
  }

  it("preserves exceptions raised by input getters", async () => {
    const failure = new Error("limit getter failed");
    const limits = {...readLimits};
    Object.defineProperty(limits, "maxValueBytes", {
      get() {
        throw failure;
      },
    });
    await expect(db.getMany([], {readLimits: limits})).rejects.toBe(failure);
    expect(() => db.entriesStream({readLimits: limits, limit: 1})).toThrow(failure);
  });
  it.skipIf(!instrumented)(
    "retires raw close after callback-reference failure during an actual pending read",
    async () => {
      const stats = native.bounded_test_stats;
      if (!stats) throw new Error("Missing bounded test instrumentation");
      await db.put(Buffer.from([1]), Buffer.alloc(4));
      const iterator = storage.iterator({...options({maxEntries: 1}), limit: 2});
      const {boundedTestContext: context} = iterator as unknown as {boundedTestContext: unknown};
      let readCompletions = 0;
      let closeCompletions = 0;
      stats(-1, 4);
      const pending = new Promise<[Buffer, Buffer][]>((resolve, reject) => {
        native.iterator_nextv(context, 1, (error, rows) => {
          readCompletions++;
          if (error) reject(error);
          else resolve(rows);
        });
      });
      try {
        expect(() =>
          native.iterator_close(context, () => {
            closeCompletions++;
          })
        ).toThrow(expect.objectContaining({code: "LEVEL_ALLOCATION_FAILED"}));
        expect(await pending).toEqual([[Buffer.from([1]), Buffer.alloc(4)]]);
        expect(readCompletions).toBe(1);
        expect(closeCompletions).toBe(0);
        expect(stats()).toMatchObject({liveArenaBytes: 0, liveWorkerRefs: 0, liveAsyncWorks: 0, liveSnapshots: 0});
        console.log("raw-close-unretained-callback-retired", stats());
      } finally {
        await pending;
        (storage as typeof storage & {detachResource(resource: unknown): void}).detachResource(iterator);
      }
    }
  );

  it.skipIf(!instrumented)("defers a retained raw close failure callback until the pending read retires", async () => {
    const stats = native.bounded_test_stats;
    if (!stats) throw new Error("Missing bounded test instrumentation");
    await db.put(Buffer.from([1]), Buffer.alloc(4));
    const iterator = storage.iterator({...options({maxEntries: 1}), limit: 2});
    const {boundedTestContext: context} = iterator as unknown as {boundedTestContext: unknown};
    const order: string[] = [];
    stats(-1, 5);
    const read = new Promise<[Buffer, Buffer][]>((resolve, reject) => {
      native.iterator_nextv(context, 1, (error, rows) => {
        order.push("read");
        if (error) reject(error);
        else resolve(rows);
      });
    });
    const close = new Promise<Error | undefined>((resolve) => {
      native.iterator_close(context, (error) => {
        order.push("close");
        resolve(error);
      });
    });
    try {
      const [rows, error] = await Promise.all([read, close]);
      expect(rows).toEqual([[Buffer.from([1]), Buffer.alloc(4)]]);
      expect(error).toMatchObject({code: "LEVEL_ALLOCATION_FAILED"});
      expect(order).toEqual(["read", "close"]);
      expect(stats()).toMatchObject({
        liveArenaBytes: 0,
        liveWorkerRefs: 0,
        liveAsyncWorks: 0,
        liveSnapshots: 0,
        workerFailureCallbacks: 1,
      });
      console.log("raw-close-retained-callback-retired", stats());
    } finally {
      await Promise.all([read, close]);
      (storage as typeof storage & {detachResource(resource: unknown): void}).detachResource(iterator);
    }
  });

  it("retains the DB while a key getter requests close during native validation", async () => {
    const key = Buffer.from([1]);
    await db.put(key, Buffer.alloc(4));
    let closing: Promise<void> | undefined;
    const keys = [key];
    Object.defineProperty(keys, 0, {
      get() {
        closing = storage.close();
        return key;
      },
    });
    expect(await storage.getMany(keys, options())).toEqual([Buffer.alloc(4)]);
    await closing;
    expect(storage.status).toBe("closed");
  });

  it("closes an initialized native iterator if validation requests DB close", async () => {
    let closing: Promise<void> | undefined;
    const limits = {...readLimits};
    Object.defineProperty(limits, "maxValueBytes", {
      get() {
        closing = storage.close();
        return 8;
      },
    });
    expect(() => storage.iterator({readLimits: limits, limit: 1})).toThrow(
      expect.objectContaining({code: "LEVEL_DATABASE_NOT_OPEN"})
    );
    await closing;
    expect(storage.status).toBe("closed");
    if (instrumented)
      expect(native.bounded_test_stats?.()).toMatchObject({
        liveArenaBytes: 0,
        liveWorkerRefs: 0,
        liveAsyncWorks: 0,
        liveSnapshots: 0,
      });
  });

  it("closes the native iterator if JS resource registration throws", async () => {
    const failure = new Error("registration failed");
    const registration = storage as typeof storage & {attachResource(resource: unknown): void};
    const original = registration.attachResource;
    registration.attachResource = () => {
      throw failure;
    };
    try {
      expect(() => storage.iterator({...options(), limit: 1})).toThrow(failure);
    } finally {
      registration.attachResource = original;
    }
    await storage.close();
    if (instrumented)
      expect(native.bounded_test_stats?.()).toMatchObject({
        liveArenaBytes: 0,
        liveWorkerRefs: 0,
        liveAsyncWorks: 0,
        liveSnapshots: 0,
      });
  });
  for (const mode of ["keys", "values"] as const) {
    it(`rejects invalid bounded ${mode} without stranding a registered wrapper`, async () => {
      const detached = new Uint8Array(1);
      structuredClone(detached.buffer, {transfer: [detached.buffer]});
      expect(() => rangeIterator(mode, {...options(), gte: detached, limit: 1})).toThrow(
        expect.objectContaining({code: "LEVEL_INVALID_READ_LIMITS"})
      );
      expect(() => rangeIterator(mode, {...options(), limit: -1})).toThrow(
        expect.objectContaining({code: "LEVEL_INVALID_READ_LIMITS"})
      );
      await storage.close();
      expect(storage.status).toBe("closed");
    });
  }

  it("captures the bounded-mode option once before a getter changes its value", async () => {
    await db.put(Buffer.from([1]), Buffer.alloc(8));
    for (const mode of ["iterator", "keys", "values"] as const) {
      let reads = 0;
      const range = {
        limit: 1,
        get readLimits(): DbReadLimits | undefined {
          return reads++ === 0 ? {...readLimits, maxValueBytes: 7, maxKeyBytes: 1} : undefined;
        },
      };
      const iterator = rangeIterator(mode, range);
      try {
        if (mode === "keys") expect(await iterator.nextv(1)).toEqual([Buffer.from([1])]);
        else await expect(iterator.nextv(1)).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
      } finally {
        await iterator.close();
      }
    }
  });
  for (const mode of ["keys", "values"] as const) {
    it(`closes the inner bounded iterator if ${mode} wrapper registration fails`, async () => {
      const failure = new Error("projection registration failed");
      const registration = storage as typeof storage & {attachResource(resource: unknown): void};
      const original = registration.attachResource;
      let calls = 0;
      registration.attachResource = function (resource) {
        if (++calls === 2) throw failure;
        original.call(this, resource);
      };
      try {
        expect(() => rangeIterator(mode, {...options(), limit: 1})).toThrow(failure);
        expect(calls).toBe(2);
      } finally {
        registration.attachResource = original;
      }
      await storage.close();
      if (instrumented)
        expect(native.bounded_test_stats?.()).toMatchObject({
          liveArenaBytes: 0,
          liveWorkerRefs: 0,
          liveAsyncWorks: 0,
          liveSnapshots: 0,
        });
    });
  }
  for (const method of ["get", "getMany"] as const) {
    it(`captures controller ${method} read policy before a getter changes it`, async () => {
      const key = Buffer.from([1]);
      await db.put(key, Buffer.alloc(8));
      let calls = 0;
      const opts = {
        get readLimits() {
          return calls++ === 0 ? {...readLimits, maxEntries: 1, maxValueBytes: 7} : undefined;
        },
      };
      const pending = method === "get" ? db.get(key, opts) : db.getMany([key], opts);
      await expect(pending).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
      expect(calls).toBe(1);
    });
  }

  for (const method of ["entriesStream", "valuesStream", "keysStream", "entries", "values", "keys"] as const) {
    it(`captures controller ${method} policy and finite range exactly once`, async () => {
      await db.batchPut([1, 2].map((n) => ({key: Buffer.from([n]), value: Buffer.alloc(8, n)})));
      let policyCalls = 0;
      let limitCalls = 0;
      const opts = {
        get readLimits() {
          return policyCalls++ === 0 ? {...readLimits, maxEntries: 1} : undefined;
        },
        get limit() {
          return limitCalls++ === 0 ? 2 : 0;
        },
      };
      let count: number;
      if (method === "entries") count = (await db.entries(opts)).length;
      else if (method === "values") count = (await db.values(opts)).length;
      else if (method === "keys") count = (await db.keys(opts)).length;
      else count = (await Array.fromAsync<unknown>(db[method](opts))).length;
      expect(count).toBe(2);
      expect(policyCalls).toBe(1);
      expect(limitCalls).toBe(1);
    });
  }

  it("does not downgrade a changing bounded stream policy to an ordinary value read", async () => {
    await db.put(Buffer.from([1]), Buffer.alloc(8));
    let calls = 0;
    const opts = {
      limit: 1,
      get readLimits() {
        return calls++ === 0 ? {...readLimits, maxEntries: 1, maxValueBytes: 7} : undefined;
      },
    };
    await expect(Array.fromAsync(db.valuesStream(opts))).rejects.toMatchObject({code: "LEVEL_READ_LIMIT"});
    expect(calls).toBe(1);
  });

  for (const method of ["entriesStream", "keysStream", "valuesStream"] as const) {
    it.skipIf(!instrumented)(`retires ${method} on return before the first pull`, async () => {
      const stats = native.bounded_test_stats;
      if (!stats) throw new Error("Missing bounded instrumentation");
      stats(-1);
      const stream = db[method]({...options({maxEntries: 1}), limit: 2})[Symbol.asyncIterator]();
      expect(stats().liveSnapshots).toBe(1);
      await db.put(Buffer.from([1]), Buffer.alloc(4));
      await stream.return?.();
      await stream.return?.();
      expect(stats()).toMatchObject({liveSnapshots: 0, liveArenaBytes: 0, liveWorkerRefs: 0, liveAsyncWorks: 0});
      console.log(`unstarted-${method}-retired`, stats());
      expect(await stream.next()).toMatchObject({done: true});
    });
  }

  it("preserves the snapshot captured when a bounded stream is created", async () => {
    await db.put(Buffer.from([1]), Buffer.alloc(4, 1));
    const stream = db.entriesStream({...options({maxEntries: 1}), limit: 2})[Symbol.asyncIterator]();
    try {
      await db.put(Buffer.from([1]), Buffer.alloc(4, 2));
      expect(await stream.next()).toEqual({done: false, value: {key: Buffer.from([1]), value: Buffer.alloc(4, 1)}});
    } finally {
      await stream.return?.();
    }
  });

  it.skipIf(!instrumented)("awaits a pending first pull before explicit return retires the snapshot", async () => {
    const stats = native.bounded_test_stats;
    if (!stats) throw new Error("Missing bounded instrumentation");
    await db.put(Buffer.from([1]), Buffer.alloc(4));
    stats(-1);
    const stream = db.entriesStream({...options({maxEntries: 1}), limit: 2})[Symbol.asyncIterator]();
    const next = stream.next();
    const returned = stream.return?.();
    expect(await next).toMatchObject({done: false});
    await returned;
    expect(stats()).toMatchObject({liveSnapshots: 0, liveArenaBytes: 0, liveWorkerRefs: 0, liveAsyncWorks: 0});
    expect(await stream.next()).toMatchObject({done: true});
  });

  it.skipIf(!instrumented)("never invokes the range input copy primitive for an empty key", async () => {
    const stats = native.bounded_test_stats;
    if (!stats) throw new Error("Missing bounded instrumentation");
    stats(-1);
    const empty = storage.iterator({...options({maxEntries: 1}), gte: new Uint8Array(0), limit: 1});
    try {
      console.log("empty-range-copy-site", stats());
      expect(stats()).toMatchObject({
        inputCopyCalls: 0,
        inputCopyBytes: 0,
        nullInputCopyOperands: 0,
        emptyInputCopiesSkipped: 1,
      });
    } finally {
      await empty.close();
    }
    stats(-1);
    const nonempty = storage.iterator({...options({maxEntries: 1}), gte: Uint8Array.of(1), limit: 1});
    try {
      expect(stats()).toMatchObject({
        inputCopyCalls: 1,
        inputCopyBytes: 1,
        nullInputCopyOperands: 0,
        emptyInputCopiesSkipped: 0,
      });
      console.log("nonempty-range-copy-site", stats());
    } finally {
      await nonempty.close();
    }
  });
});
