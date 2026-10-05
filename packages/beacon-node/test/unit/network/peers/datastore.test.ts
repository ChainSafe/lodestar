import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Key} from "interface-datastore";
import {DeleteFailedError, GetFailedError, NotFoundError, OpenFailedError, PutFailedError} from "interface-store";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDb} from "@chainsafe/lodestar-z/leveldb";
import {Eth2PeerDataStore} from "../../../../src/network/peers/datastore.js";
import {NativeDatastore} from "../../../../src/network/peers/nativeDatastore.js";

describe("Eth2PeerDataStore", () => {
  let eth2Datastore: Eth2PeerDataStore;
  let dbDatastoreStub: NativeDatastore;

  beforeEach(() => {
    vi.useFakeTimers({now: Date.now()});

    dbDatastoreStub = new NativeDatastore("unused");
    vi.spyOn(dbDatastoreStub, "get");
    vi.spyOn(dbDatastoreStub, "batch").mockReturnValue({
      put: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    });
    eth2Datastore = new Eth2PeerDataStore(dbDatastoreStub, {threshold: 2, maxMemoryItems: 3});

    vi.spyOn(dbDatastoreStub, "put").mockImplementation(async (key) => key);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should persist to db after threshold put", async () => {
    await eth2Datastore.put(new Key("k1"), Buffer.from("1"));
    expect(dbDatastoreStub.batch).not.toHaveBeenCalledTimes(1);
    await eth2Datastore.put(new Key("k2"), Buffer.from("2"));
    expect(dbDatastoreStub.batch).toHaveBeenCalledTimes(1);
  });

  it("should persist to db the oldest item after max", async () => {
    // oldest item
    await eth2Datastore.put(new Key("k1"), Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    vi.advanceTimersByTime(1000);

    // 2nd, not call dbDatastoreStub.put yet
    await eth2Datastore.put(new Key("k2"), Buffer.from("2"));
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.put).not.toHaveBeenCalledTimes(1);
    // 3rd item, not call dbDatastoreStub.put yet
    await eth2Datastore.put(new Key("k3"), Buffer.from("3"));
    expect(await eth2Datastore.get(new Key("k3"))).toEqual(Buffer.from("3"));
    expect(dbDatastoreStub.put).not.toHaveBeenCalledTimes(1);

    // 4th item, should evict 1st item since it's oldest
    await eth2Datastore.put(new Key("k4"), Buffer.from("4"));
    expect(await eth2Datastore.get(new Key("k4"))).toEqual(Buffer.from("4"));
    expect(dbDatastoreStub.put).toHaveBeenCalledTimes(1);
    expect(dbDatastoreStub.put).toHaveBeenCalledWith(new Key("/k1"), Buffer.from("1"));

    // still able to get k1 from datastore
    expect(dbDatastoreStub.get).not.toHaveBeenCalledTimes(1);
    vi.mocked(dbDatastoreStub.get).mockResolvedValue(Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);

    // access k1 again, should not query db
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);
    expect(dbDatastoreStub.get).not.toHaveBeenCalledTimes(2);
  });

  it("should put to memory cache if item was found from db", async () => {
    vi.mocked(dbDatastoreStub.get).mockResolvedValue(Buffer.from("1"));
    // query db for the first time
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);

    // this time it should not query from db
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);
    expect(dbDatastoreStub.get).not.toHaveBeenCalledTimes(2);
  });
});

describe("native peer datastore", () => {
  let directory: string;
  let datastore: NativeDatastore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-native-peers-"));
    datastore = new NativeDatastore(directory);
    await datastore.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await datastore.close();
    await rm(directory, {recursive: true, force: true});
  });

  it("persists UTF-8 keys and distinguishes empty values from missing records", async () => {
    const key = new Key("/peers/é/😀");
    const empty = new Key("/peers/empty");
    const value = Uint8Array.of(0, 1, 255);
    expect(await datastore.put(key, value)).toEqual(key);
    await datastore.put(empty, new Uint8Array());
    await datastore.close();
    await datastore.open();
    expect(await datastore.get(key)).toEqual(value);
    expect(await datastore.get(empty)).toEqual(new Uint8Array());
    expect(await datastore.has(empty)).toBe(true);
    expect(await datastore.has(new Key("/peers/missing"))).toBe(false);
    await expect(datastore.get(new Key("/peers/missing"))).rejects.toBeInstanceOf(NotFoundError);
    await datastore.delete(key);
    await datastore.delete(key);
    expect(await datastore.has(key)).toBe(false);
  });

  it("reads and writes the legacy UTF-8 key encoding without an extra prefix", async () => {
    const key = new Key("/peers/é/😀");
    await datastore.close();
    const raw = await LevelDb.open(directory);
    try {
      await raw.put(Buffer.from(key.toString(), "utf8"), Uint8Array.of(1));
    } finally {
      await raw.close();
    }
    await datastore.open();
    expect(await datastore.get(key)).toEqual(Uint8Array.of(1));
    await datastore.put(key, Uint8Array.of(2));
    await datastore.close();
    const reopened = await LevelDb.open(directory);
    try {
      expect(await reopened.get(Buffer.from(key.toString(), "utf8"))).toEqual(Uint8Array.of(2));
    } finally {
      await reopened.close();
    }
  });

  it("waits for close before reopening and rejects reads during close", async () => {
    const key = new Key("/peer");
    await datastore.put(key, Uint8Array.of(1));
    const close = datastore.close();
    expect(datastore.close()).toBe(close);
    await expect(datastore.get(key)).rejects.toBeInstanceOf(GetFailedError);
    const reopen = datastore.open();
    await Promise.all([close, reopen]);
    expect(await datastore.get(key)).toEqual(Uint8Array.of(1));
  });

  it("can retry a failed open and shares concurrent opens", async () => {
    await datastore.close();
    const open = vi.spyOn(LevelDb, "open").mockRejectedValueOnce(new Error("open failed"));
    await expect(datastore.open()).rejects.toBeInstanceOf(OpenFailedError);
    await Promise.all([datastore.open(), datastore.open()]);
    expect(open).toHaveBeenCalledTimes(2);
    expect(await datastore.has(new Key("/missing"))).toBe(false);
  });

  it("preserves operation error classes and does not turn read failures into missing keys", async () => {
    const key = new Key("/peer");
    const failure = new Error("read failed");
    vi.spyOn(LevelDb.prototype, "get").mockRejectedValue(failure);
    await expect(datastore.get(key)).rejects.toBeInstanceOf(GetFailedError);
    await expect(datastore.has(key)).rejects.toBe(failure);
    const peers = new Eth2PeerDataStore(datastore);
    await expect(peers.has(key)).rejects.toBeInstanceOf(GetFailedError);
    vi.spyOn(LevelDb.prototype, "put").mockRejectedValue(failure);
    vi.spyOn(LevelDb.prototype, "del").mockRejectedValue(failure);
    await expect(datastore.put(key, new Uint8Array())).rejects.toBeInstanceOf(PutFailedError);
    await expect(datastore.delete(key)).rejects.toBeInstanceOf(DeleteFailedError);
  });

  it("flushes dirty cached peers below the threshold on close", async () => {
    const peers = new Eth2PeerDataStore(datastore, {threshold: 2, maxMemoryItems: 3});
    const key = new Key("/peer");
    await peers.put(key, Uint8Array.of(7));
    expect(await datastore.has(key)).toBe(false);
    await peers.close();
    await datastore.open();
    expect(await datastore.get(key)).toEqual(Uint8Array.of(7));
    await datastore.delete(key);
    expect(await peers.has(key)).toBe(false);
  });

  it("closes the database even when the shutdown flush fails", async () => {
    const peers = new Eth2PeerDataStore(datastore, {threshold: 2, maxMemoryItems: 3});
    const key = new Key("/peer");
    await peers.put(key, Uint8Array.of(7));
    const failure = new Error("batch failed");
    vi.spyOn(LevelDb.prototype, "batch").mockRejectedValueOnce(failure);
    const close = vi.spyOn(datastore, "close");
    await expect(peers.close()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    await peers.close();
    await datastore.open();
    expect(await peers.has(key)).toBe(false);
  });

  it("commits native batches atomically in operation order", async () => {
    const key = new Key("/peer");
    const removed = new Key("/removed");
    await datastore.put(removed, Uint8Array.of(9));
    const nativeBatch = vi.spyOn(LevelDb.prototype, "batch");
    const batch = datastore.batch();
    batch.put(key, Uint8Array.of(1));
    batch.delete(key);
    batch.put(key, Uint8Array.of(2));
    batch.delete(removed);
    expect(await datastore.has(key)).toBe(false);
    expect(await datastore.has(removed)).toBe(true);
    expect(nativeBatch).not.toHaveBeenCalled();
    await batch.commit();
    expect(nativeBatch).toHaveBeenCalledExactlyOnceWith([
      {type: "put", key: Buffer.from("/peer"), value: Uint8Array.of(1)},
      {type: "del", key: Buffer.from("/peer")},
      {type: "put", key: Buffer.from("/peer"), value: Uint8Array.of(2)},
      {type: "del", key: Buffer.from("/removed")},
    ]);
    expect(await datastore.get(key)).toEqual(Uint8Array.of(2));
    expect(await datastore.has(removed)).toBe(false);
  });

  it("leaves every record unchanged when a native batch contains an invalid key", async () => {
    const existing = new Key("/existing");
    const inserted = new Key("/inserted");
    await datastore.put(existing, Uint8Array.of(1));
    const batch = datastore.batch();
    batch.put(inserted, Uint8Array.of(2));
    batch.delete(existing);
    batch.put(new Key(`/${"k".repeat(4096)}`), Uint8Array.of(3));
    await expect(batch.commit()).rejects.toMatchObject({code: "KeyTooLarge"});
    expect(await datastore.has(inserted)).toBe(false);
    expect(await datastore.get(existing)).toEqual(Uint8Array.of(1));
  });

  it("opens the native backend when the peer datastore receives a directory", async () => {
    await datastore.close();
    const peers = new Eth2PeerDataStore(directory, {threshold: 1, maxMemoryItems: 2});
    await peers.open();
    try {
      await peers.put(new Key("/peer"), Uint8Array.of(7));
      expect(await peers.has(new Key("/missing"))).toBe(false);
    } finally {
      await peers.close();
    }
    await datastore.open();
    expect(await datastore.get(new Key("/peer"))).toEqual(Uint8Array.of(7));
  });

  it("applies prefix filters ordering offset and limit once for entries and keys", async () => {
    for (const key of ["/peers/a", "/peers/é", "/peers/😀", "/other/a"]) {
      await datastore.put(new Key(key), Buffer.from(key));
    }
    const prefix = "/peers/";
    const descending = (a: Key, b: Key): -1 | 0 | 1 =>
      a.toString() === b.toString() ? 0 : a.toString() > b.toString() ? -1 : 1;
    const entries = await Array.fromAsync(
      datastore.query({
        prefix,
        filters: [(pair) => pair.value.length > 0],
        orders: [(a, b) => descending(a.key, b.key)],
        offset: 1,
        limit: 1,
      })
    );
    expect(entries.map(({key}) => key.toString())).toEqual(["/peers/é"]);
    const keys = await Array.fromAsync(datastore.queryKeys({prefix, orders: [descending], offset: 1, limit: 1}));
    expect(keys.map((key) => key.toString())).toEqual(["/peers/é"]);
    expect((await Array.fromAsync(datastore.query({prefix: "/peers/😀"}))).map(({key}) => key.toString())).toEqual([
      "/peers/😀",
    ]);
  });

  it("preserves datastore string-prefix semantics with normalized slash keys", async () => {
    for (const key of ["peers/a", "/peers/b", "/peers-extra/c", "/other/d"]) {
      await datastore.put(new Key(key), new Uint8Array());
    }
    for (const [prefix, expected] of [
      ["/peers", ["/peers-extra/c", "/peers/a", "/peers/b"]],
      ["/peers/", ["/peers/a", "/peers/b"]],
      ["peers", []],
      ["/", ["/other/d", "/peers-extra/c", "/peers/a", "/peers/b"]],
    ] as const) {
      const keys = await Array.fromAsync(datastore.queryKeys({prefix}));
      expect(
        keys.map((key) => key.toString()),
        `prefix ${prefix}`
      ).toEqual(expected);
      const entries = await Array.fromAsync(datastore.query({prefix}));
      expect(
        entries.map(({key}) => key.toString()),
        `prefix ${prefix}`
      ).toEqual(expected);
    }
  });

  it("closes native cursors when consumers stop or abort a query", async () => {
    await datastore.put(new Key("/a"), Uint8Array.of(1));
    await datastore.put(new Key("/b"), Uint8Array.of(2));
    const createIterator = LevelDb.prototype.iterator;
    const iterator = vi.spyOn(LevelDb.prototype, "iterator").mockImplementation(function (this: LevelDb, options) {
      return createIterator.call(this, {...options, maxEntries: 1});
    });
    const query = datastore.query({});
    await query.next();
    const native = iterator.mock.results[0].value;
    const close = vi.spyOn(native, "close");
    await query.return(undefined);
    expect(close).toHaveBeenCalled();

    const abort = new AbortController();
    const aborted = datastore.query({}, {signal: abort.signal});
    await aborted.next();
    const abortedNative = iterator.mock.results[1].value;
    const abortedClose = vi.spyOn(abortedNative, "close");
    abort.abort();
    await expect(aborted.next()).rejects.toBe(abort.signal.reason);
    expect(abortedClose).toHaveBeenCalled();
  });

  it("keeps a query snapshot stable across writes and closes on filter failure", async () => {
    const createIterator = LevelDb.prototype.iterator;
    vi.spyOn(LevelDb.prototype, "iterator").mockImplementation(function (this: LevelDb, options) {
      return createIterator.call(this, {...options, maxEntries: 1});
    });
    await datastore.put(new Key("/a"), Uint8Array.of(1));
    await datastore.put(new Key("/b"), Uint8Array.of(2));
    const query = datastore.query({});
    expect((await query.next()).value?.key.toString()).toBe("/a");
    await datastore.put(new Key("/b"), Uint8Array.of(3));
    await datastore.put(new Key("/c"), Uint8Array.of(4));
    expect((await query.next()).value?.value).toEqual(Uint8Array.of(2));
    expect((await query.next()).done).toBe(true);

    const createKeys = LevelDb.prototype.keys;
    const iterator = vi.spyOn(LevelDb.prototype, "keys").mockImplementation(function (this: LevelDb, options) {
      return createKeys.call(this, {...options, maxEntries: 1});
    });
    const failure = new Error("filter failed");
    const filtered = datastore.queryKeys({
      filters: [
        () => {
          throw failure;
        },
      ],
    });
    await expect(filtered.next()).rejects.toBe(failure);
    expect(await iterator.mock.results[0].value.next()).toMatchObject({done: true});
  });

  it("releases snapshots after limited key queries", async () => {
    const createKeys = LevelDb.prototype.keys;
    vi.spyOn(LevelDb.prototype, "keys").mockImplementation(function (this: LevelDb, options) {
      return createKeys.call(this, {...options, maxEntries: 1});
    });
    await datastore.put(new Key("/a"), Uint8Array.of(1));
    await datastore.put(new Key("/b"), Uint8Array.of(2));
    for (let index = 0; index < 70; index++) {
      const keys = await Array.fromAsync(datastore.queryKeys({limit: 1}));
      expect(
        keys.map((key) => key.toString()),
        `query ${index}`
      ).toEqual(["/a"]);
    }
  });

  it("rejects aborted writes before entering the native queue", async () => {
    const signal = AbortSignal.abort();
    const key = new Key("/peer");
    const put = vi.spyOn(LevelDb.prototype, "put");
    const batch = vi.spyOn(LevelDb.prototype, "batch");
    await expect(datastore.put(key, Uint8Array.of(1), {signal})).rejects.toBe(signal.reason);
    const pending = datastore.batch();
    pending.put(key, Uint8Array.of(2));
    await expect(pending.commit({signal})).rejects.toBe(signal.reason);
    expect(put).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(await datastore.has(key)).toBe(false);
  });

  it("merges cached and persisted peers without duplicate rows or repeated query limits", async () => {
    const peers = new Eth2PeerDataStore(datastore, {threshold: 1, maxMemoryItems: 2});
    for (const key of ["/peer/a", "/peer/b", "/peer/c"]) {
      await peers.put(new Key(key), Buffer.from(key));
    }
    expect(await peers.has(new Key("/missing"))).toBe(false);
    const rows = await Array.fromAsync(peers.query({prefix: "/peer/"}));
    expect(rows.map(({key}) => key.toString()).sort()).toEqual(["/peer/a", "/peer/b", "/peer/c"]);
    const keys = await Array.fromAsync(peers.queryKeys({prefix: "/peer/", offset: 1, limit: 1}));
    expect(keys.map((key) => key.toString())).toEqual([rows[1].key.toString()]);
    await peers.put(new Key("/peer/b"), Buffer.from("updated"));
    const updated = await Array.fromAsync(peers.query({prefix: "/peer/b"}));
    expect(updated).toHaveLength(1);
    expect(updated[0].value).toEqual(Buffer.from("updated"));
  });
});
