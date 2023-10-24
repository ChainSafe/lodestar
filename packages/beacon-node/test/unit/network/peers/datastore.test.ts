import {LevelDatastore} from "datastore-level";
import {Key} from "interface-datastore";
import {describe, it, expect, beforeEach, afterEach, vi, MockedObject} from "vitest";
import {Eth2PeerDataStore} from "../../../../src/network/peers/datastore.js";

vi.mock("datastore-level");

describe("Eth2PeerDataStore", () => {
  let eth2Datastore: Eth2PeerDataStore;
  let dbDatastoreStub: MockedObject<LevelDatastore>;

  beforeEach(() => {
    vi.useFakeTimers({now: Date.now()});

    dbDatastoreStub = vi.mocked(new LevelDatastore({} as any));
    eth2Datastore = new Eth2PeerDataStore(dbDatastoreStub, {threshold: 2, maxMemoryItems: 3});

    vi.spyOn(dbDatastoreStub, "put").mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
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
    dbDatastoreStub.get.mockResolvedValue(Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);

    // access k1 again, should not query db
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);
    expect(dbDatastoreStub.get).not.toHaveBeenCalledTimes(2);
  });

  it("should put to memory cache if item was found from db", async () => {
    dbDatastoreStub.get.mockResolvedValue(Buffer.from("1"));
    // query db for the first time
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);

    // this time it should not query from db
    expect(await eth2Datastore.get(new Key("k1"))).toEqual(Buffer.from("1"));
    expect(dbDatastoreStub.get).toHaveBeenCalledTimes(1);
    expect(dbDatastoreStub.get).not.toHaveBeenCalledTimes(2);
  });
});
