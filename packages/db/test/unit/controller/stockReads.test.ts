import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ClassicLevel} from "classic-level";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {ContainerType, UintNumberType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {getEnvLogger} from "@lodestar/logger/env";
import {LevelDbController, PrefixedRepository, Repository} from "../../../src/index.js";

type Options = {fillCache?: boolean; readLimits?: unknown; limit?: number};
type Call = {call: string; fillCache?: boolean; size?: number};

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
  let storage: ClassicLevel<Uint8Array, Uint8Array>;
  let calls: Call[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-stock-reads-"));
    storage = new ClassicLevel(join(directory, "db"), {keyEncoding: "binary", valueEncoding: "binary"});
    db = await LevelDbController.create(
      {name: join(directory, "db"), db: storage},
      {metrics: null, logger: getEnvLogger()}
    );
    calls = [];
    const level = storage as unknown as {
      get(key: Uint8Array, opts?: Options): Promise<unknown>;
      getMany(keys: Uint8Array[], opts?: Options): Promise<unknown>;
      iterator(opts?: Options): {nextv(size: number): Promise<unknown>; next(): Promise<unknown>};
    };
    const get = level.get.bind(level);
    const getMany = level.getMany.bind(level);
    const iterator = level.iterator.bind(level);
    level.get = (key, opts) => {
      calls.push({call: "get", fillCache: opts?.fillCache});
      return get(key, opts);
    };
    level.getMany = (keys, opts) => {
      calls.push({call: "getMany", fillCache: opts?.fillCache});
      return getMany(keys, opts);
    };
    level.iterator = (opts) => {
      calls.push({call: "iterator", fillCache: opts?.fillCache});
      const it = iterator(opts);
      const nextv = it.nextv.bind(it);
      const next = it.next.bind(it);
      it.nextv = (size) => {
        calls.push({call: "nextv", size});
        return nextv(size);
      };
      it.next = () => {
        calls.push({call: "next"});
        return next();
      };
      return it;
    };
  });

  afterEach(async () => {
    await db?.close();
    await rm(directory, {recursive: true, force: true});
  });

  it("forwards fillCache through repositories and the controller to classic-level", async () => {
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
    expect(calls.filter(({call}) => call !== "next" && call !== "nextv")).toEqual([
      {call: "get", fillCache: false},
      {call: "get", fillCache: false},
      {call: "get", fillCache: false},
      {call: "getMany", fillCache: false},
      {call: "iterator", fillCache: false},
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
    expect(calls.filter(({call}) => call === "next")).toEqual([]);
    // One read per row and one that finds the end
    expect(calls.filter(({call}) => call === "nextv")).toEqual(
      Array.from({length: 6}, () => ({call: "nextv", size: 1}))
    );

    // classic-level reads a limit of -1 as no limit
    expect(await Array.fromAsync(rows.binaryEntriesStream({rowAtATime: true, gte: 0, lt: 5, limit: -1}))).toHaveLength(
      5
    );

    calls.length = 0;
    const limited = await Array.fromAsync(rows.binaryEntriesStream({rowAtATime: true, gte: 0, lt: 5, limit: 2}));
    expect(limited).toHaveLength(2);
    expect(calls.filter(({call}) => call === "nextv")).toHaveLength(2);

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
    const usage = (): number => Number(storage.getProperty("leveldb.approximate-memory-usage"));
    const before = usage();
    expect((await db.get(key, {fillCache: false}))?.byteLength).toBe(1024 * 1024);
    expect((await db.getMany([key], {fillCache: false}))[0]?.byteLength).toBe(1024 * 1024);
    expect(usage() - before).toBeLessThan(64 * 1024);
    await db.get(key);
    expect(usage() - before).toBeGreaterThan(1024 * 1024);
  });
});
