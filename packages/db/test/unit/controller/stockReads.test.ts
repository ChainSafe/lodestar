import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDb} from "@chainsafe/lodestar-z/leveldb";
import {ContainerType, UintNumberType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {getEnvLogger} from "@lodestar/logger/env";
import {LevelDbController, PrefixedRepository, Repository} from "../../../src/index.js";

type Call = {call: string; fillCache?: boolean; maxEntries?: number; limit?: number};

const type = new ContainerType({value: new UintNumberType(8)});

class Rows extends Repository<number, {value: number}> {
  constructor(db: LevelDbController) {
    super({} as ChainForkConfig, db, 1, type, "rows");
  }
}

class PrefixedRows extends PrefixedRepository<number, number, {value: number}> {
  constructor(db: LevelDbController) {
    super({} as ChainForkConfig, db, 2, type, "prefixed");
  }
  getId(value: {value: number}): number {
    return value.value;
  }
  encodeKeyRaw(prefix: number, id: number): Uint8Array {
    return new Uint8Array([prefix, id]);
  }
  decodeKeyRaw(raw: Uint8Array): {prefix: number; id: number} {
    return {prefix: raw[0], id: raw[1]};
  }
  getMaxKeyRaw(prefix: number): Uint8Array {
    return new Uint8Array([prefix, 255]);
  }
  getMinKeyRaw(prefix: number): Uint8Array {
    return new Uint8Array([prefix, 0]);
  }
}

describe("stock LevelDB serving reads", () => {
  let directory: string;
  let db: LevelDbController;
  let storage: LevelDb;
  let calls: Call[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-stock-reads-"));
    storage = await LevelDb.open(join(directory, "db"));
    db = await LevelDbController.create(
      {name: join(directory, "db"), db: storage},
      {metrics: null, logger: getEnvLogger()}
    );
    calls = [];
    const get = storage.get.bind(storage);
    const getMany = storage.getMany.bind(storage);
    const iterator = storage.iterator.bind(storage);
    vi.spyOn(storage, "get").mockImplementation((key, opts) => {
      calls.push({call: "get", fillCache: opts?.fillCache});
      return get(key, opts);
    });
    vi.spyOn(storage, "getMany").mockImplementation((keys, opts) => {
      calls.push({call: "getMany", fillCache: opts?.fillCache});
      return getMany(keys, opts);
    });
    vi.spyOn(storage, "iterator").mockImplementation((opts) => {
      calls.push({call: "iterator", fillCache: opts?.fillCache, maxEntries: opts?.maxEntries, limit: opts?.limit});
      return iterator(opts);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.close();
    await rm(directory, {recursive: true, force: true});
  });

  it("forwards fillCache through repositories and the controller to the native binding", async () => {
    const rows = new Rows(db);
    const prefixed = new PrefixedRows(db);
    for (let value = 0; value < 3; value++) {
      await rows.put(value, {value});
      await prefixed.put(7, {value});
    }
    calls.length = 0;
    await rows.get(1, {fillCache: false});
    await rows.getBinary(1, {fillCache: false});
    await prefixed.getBinary(7, 1, {fillCache: false});
    await prefixed.getManyBinary(7, [0, 1], {fillCache: false});
    await Array.fromAsync(rows.binaryEntriesStream({fillCache: false, gte: 0, lt: 3}));
    expect(calls).toEqual([
      {call: "get", fillCache: false},
      {call: "get", fillCache: false},
      {call: "get", fillCache: false},
      {call: "getMany", fillCache: false},
      {call: "iterator", fillCache: false, maxEntries: undefined, limit: undefined},
    ]);
    // Reads without the option keep the stock defaults
    calls.length = 0;
    await rows.getBinary(1);
    await prefixed.getManyBinary(7, [0]);
    expect(calls).toEqual([
      {call: "get", fillCache: undefined},
      {call: "getMany", fillCache: undefined},
    ]);
  });

  it("reads a row-at-a-time stream with one row per native read and closes it on return", async () => {
    const rows = new Rows(db);
    for (let value = 0; value < 5; value++) await rows.put(value, {value});
    calls.length = 0;
    const all = await Array.fromAsync(rows.binaryEntriesStream({fillCache: false, rowAtATime: true, gte: 0, lt: 5}));
    expect(all.map(({value}) => type.deserialize(value).value)).toEqual([0, 1, 2, 3, 4]);
    expect(calls).toEqual([{call: "iterator", fillCache: false, maxEntries: 1, limit: undefined}]);

    expect(await Array.fromAsync(rows.binaryEntriesStream({rowAtATime: true, gte: 0, lt: 5, limit: -1}))).toHaveLength(
      5
    );

    calls.length = 0;
    const limited = await Array.fromAsync(rows.binaryEntriesStream({rowAtATime: true, gte: 0, lt: 5, limit: 2}));
    expect(limited).toHaveLength(2);
    expect(calls).toEqual([{call: "iterator", fillCache: true, maxEntries: 1, limit: 2}]);

    const stream = rows.binaryEntriesStream({rowAtATime: true, gte: 0, lt: 5})[Symbol.asyncIterator]();
    expect((await stream.next()).done).toBe(false);
    await stream.return?.();
    // Once closed, the database closes without waiting for the iterator
    await db.close();
  });

  it("keeps fillCache false reads out of the LevelDB block cache", async () => {
    // A compressible value larger than a cache shard, read from a table after the memtable is compacted
    const key = new Uint8Array([9, 1]);
    await db.put(key, new Uint8Array(1024 * 1024));
    await storage.compactRange(new Uint8Array([0]), new Uint8Array([255]));
    const usage = async (): Promise<number> => Number(await storage.getProperty("leveldb.approximate-memory-usage"));
    const before = await usage();
    expect((await db.get(key, {fillCache: false}))?.byteLength).toBe(1024 * 1024);
    expect((await db.getMany([key], {fillCache: false}))[0]?.byteLength).toBe(1024 * 1024);
    expect((await usage()) - before).toBeLessThan(64 * 1024);
    await db.get(key);
    expect((await usage()) - before).toBeGreaterThan(1024 * 1024);
  });
});
