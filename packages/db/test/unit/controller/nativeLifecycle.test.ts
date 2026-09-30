import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDb} from "@chainsafe/lodestar-z/leveldb";
import {getEnvLogger} from "@lodestar/logger/env";
import {defer} from "@lodestar/utils";
import {LevelDbController} from "../../../src/controller/level.js";
import {LevelDbControllerMetrics} from "../../../src/controller/metrics.js";

describe("native LevelDB controller lifecycle", () => {
  let directory: string;
  let storage: LevelDb;
  let db: LevelDbController;
  let metrics: LevelDbControllerMetrics;
  const entries = [1, 2, 3].map((i) => ({key: Uint8Array.of(i), value: Uint8Array.of(i + 10)}));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-native-db-"));
    storage = await LevelDb.open(join(directory, "db"));
    db = await LevelDbController.create({name: join(directory, "db"), db: storage}, {logger: getEnvLogger()});
    metrics = {
      dbReadReq: {inc: vi.fn()},
      dbReadItems: {inc: vi.fn()},
      dbWriteReq: {inc: vi.fn()},
      dbWriteItems: {inc: vi.fn()},
      dbSizeTotal: {inc: vi.fn(), dec: vi.fn(), set: vi.fn(), reset: vi.fn()},
      dbApproximateSizeTime: {startTimer: () => () => 0, observe: vi.fn(), reset: vi.fn()},
    };
    db.setMetrics(metrics);
    await db.batchPut(entries);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(directory, {recursive: true, force: true});
  });

  it("shares the close promise until the native close finishes", async () => {
    const gate = defer<void>();
    const close = storage.close.bind(storage);
    const closeSpy = vi.spyOn(storage, "close").mockImplementation(() => gate.promise.then(close));
    const first = db.close();
    const second = db.close();
    expect(second).toBe(first);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    let finished = false;
    void second.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    await first;
    expect(finished).toBe(true);
    expect(db.close()).toBe(first);
  });

  it("reports close failures and lets later calls retry", async () => {
    const failed = new LevelDbController(getEnvLogger(), storage, null);
    const error = new Error("close failed");
    const close = vi.spyOn(storage, "close").mockRejectedValueOnce(error);
    const closing = failed.close();
    expect(failed.close()).toBe(closing);
    await expect(closing).rejects.toBe(error);
    await expect(failed.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it.each(["keysStream", "valuesStream", "entriesStream"] as const)(
    "%s releases snapshots on return before the first pull",
    async (method) => {
      for (let i = 0; i < 65; i++) {
        const stream = db[method]()[Symbol.asyncIterator]();
        await stream.return?.();
        expect((await stream.next()).done, `stream ${i} must stay closed`).toBe(true);
      }
      expect(metrics.dbReadReq.inc).not.toHaveBeenCalled();
      expect(metrics.dbReadItems.inc).not.toHaveBeenCalled();
      expect(await db.entries()).toEqual(entries);
    }
  );

  it.each(["keysStream", "valuesStream", "entriesStream"] as const)(
    "%s counts yielded rows and closes on an early break",
    async (method) => {
      for await (const _item of db[method]({bucketId: "rows", rowAtATime: true})) break;
      expect(metrics.dbReadReq.inc).toHaveBeenCalledExactlyOnceWith({bucket: "rows"}, 1);
      expect(metrics.dbReadItems.inc).toHaveBeenCalledExactlyOnceWith({bucket: "rows"}, 1);
    }
  );

  it("closes an unstarted iterator on throw", async () => {
    const error = new Error("consumer failed");
    const stream = db.entriesStream()[Symbol.asyncIterator]();
    await expect(stream.throw?.(error)).rejects.toBe(error);
    expect((await stream.next()).done).toBe(true);
    expect(metrics.dbReadReq.inc).not.toHaveBeenCalled();
  });

  it("records partial reads and closes when a native pull fails", async () => {
    const native = storage.iterator({maxEntries: 1});
    vi.spyOn(storage, "iterator").mockReturnValueOnce(native);
    const close = vi.spyOn(native, "close");
    const next = native.next.bind(native);
    const error = new Error("read failed");
    vi.spyOn(native, "next").mockImplementationOnce(next).mockRejectedValueOnce(error);
    const stream = db.entriesStream({bucketId: "rows"})[Symbol.asyncIterator]();
    expect((await stream.next()).done).toBe(false);
    await expect(stream.next()).rejects.toBe(error);
    expect(close).toHaveBeenCalled();
    expect(metrics.dbReadItems.inc).toHaveBeenCalledExactlyOnceWith({bucket: "rows"}, 1);
  });

  it("uses native projected iterators and records complete reads", async () => {
    const keys = vi.spyOn(storage, "keys");
    const values = vi.spyOn(storage, "values");
    const iterator = vi.spyOn(storage, "iterator");
    expect(await db.keys({bucketId: "rows"})).toEqual(entries.map(({key}) => key));
    expect(await db.values({bucketId: "rows"})).toEqual(entries.map(({value}) => value));
    expect(keys).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(iterator).not.toHaveBeenCalled();
    expect(metrics.dbReadReq.inc).toHaveBeenCalledTimes(2);
    expect(metrics.dbReadItems.inc).toHaveBeenNthCalledWith(1, {bucket: "rows"}, 3);
    expect(metrics.dbReadItems.inc).toHaveBeenNthCalledWith(2, {bucket: "rows"}, 3);
  });

  it.each([-1, -2, 1.5, Number.NaN, Infinity])("treats invalid limit %s as unlimited", async (limit) => {
    expect(await db.entries({limit})).toEqual(entries);
    expect(await Array.fromAsync(db.entriesStream({limit, rowAtATime: true}))).toEqual(entries);
  });

  it("honors exclusive bounds, reverse traversal and zero limits", async () => {
    const opts = {gt: entries[0].key, lte: entries[2].key, reverse: true};
    expect(await db.entries(opts)).toEqual([entries[2], entries[1]]);
    expect(await db.keys({...opts, limit: 1})).toEqual([entries[2].key]);
    expect(await db.values({gte: entries[0].key, lt: entries[2].key})).toEqual([entries[0].value, entries[1].value]);
    expect(await db.entries({limit: 0})).toEqual([]);
  });

  it("preserves empty values, missing keys, duplicate keys and empty requests", async () => {
    const key = Uint8Array.of(4);
    await db.put(key, new Uint8Array());
    expect(await db.getMany([key, Uint8Array.of(5), key])).toEqual([new Uint8Array(), undefined, new Uint8Array()]);
    expect(await db.getMany([])).toEqual([]);
    await db.batch([]);
    await db.batchPut([]);
    await db.batchDelete([]);
  });

  it("passes ordered writes as one native batch", async () => {
    const batch = vi.spyOn(storage, "batch");
    const key = entries[0].key;
    const value = Uint8Array.of(99);
    const operations = [
      {type: "del" as const, key},
      {type: "put" as const, key, value},
    ];
    await db.batch(operations);
    expect(batch).toHaveBeenCalledExactlyOnceWith(operations);
    expect(await db.get(key)).toEqual(value);
    expect(metrics.dbWriteItems.inc).toHaveBeenLastCalledWith({bucket: "unknown"}, 2);
  });

  it("writes and reads more than one iterator page without splitting batches", async () => {
    const batch = vi.spyOn(storage, "batch");
    const items = Array.from({length: 1025}, (_, i) => ({
      key: Uint8Array.of(10, i >> 8, i & 0xff),
      value: Uint8Array.of(i & 0xff),
    }));
    await db.batchPut(items);
    expect(batch).toHaveBeenCalledTimes(1);
    const keys = items.map(({key}) => key);
    expect(await db.getMany(keys)).toEqual(items.map(({value}) => value));
    expect(await db.entries({gte: items[0].key})).toEqual(items);
    await db.batchDelete(keys);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(await db.entries()).toEqual(entries);
  });

  it("rejects an invalid batch without applying its earlier operations", async () => {
    await expect(
      db.batch([
        {type: "del", key: entries[0].key},
        {type: "put", key: new Uint8Array(4097), value: Uint8Array.of(1)},
      ])
    ).rejects.toMatchObject({code: "KeyTooLarge"});
    expect(await db.entries()).toEqual(entries);
  });

  it("clears through the native API", async () => {
    const clear = vi.spyOn(storage, "clear");
    await db.clear();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await db.entries()).toEqual([]);
    await db.put(entries[0].key, entries[0].value);
    expect(await db.entries()).toEqual([entries[0]]);
  });
});
