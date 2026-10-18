import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {MemoryDatastore} from "datastore-core";
import {LevelDatastore} from "datastore-level";
import {Key} from "interface-datastore";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Eth2PeerDataStore} from "../../../../src/network/peers/datastore.js";

describe("Eth2PeerDataStore", () => {
  let eth2Datastore: Eth2PeerDataStore;
  let dbDatastoreStub: MemoryDatastore & {open(): Promise<void>; close(): Promise<void>};

  beforeEach(() => {
    vi.useFakeTimers({now: Date.now()});

    dbDatastoreStub = Object.assign(new MemoryDatastore(), {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
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

  it.each(["flush", "close", "both"])("preserves %s failures during close", async (failed) => {
    const flushError = new Error("flush failed");
    const closeError = new Error("close failed");
    await eth2Datastore.put(new Key("k1"), Buffer.from("1"));
    const batch = dbDatastoreStub.batch();
    if (failed !== "close") vi.mocked(batch.commit).mockRejectedValue(flushError);
    const close = vi.spyOn(dbDatastoreStub, "close");
    if (failed !== "flush") close.mockRejectedValue(closeError);
    else close.mockResolvedValue();
    const result = eth2Datastore.close();
    if (failed === "both") await expect(result).rejects.toMatchObject({errors: [flushError, closeError]});
    else await expect(result).rejects.toBe(failed === "flush" ? flushError : closeError);
    expect(close).toHaveBeenCalledOnce();
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

describe("persistent peer datastore", () => {
  let directory: string;
  let datastore: LevelDatastore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "lodestar-peers-"));
    datastore = new LevelDatastore(directory);
    await datastore.open();
  });

  afterEach(async () => {
    await datastore.close();
    await rm(directory, {recursive: true, force: true});
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
