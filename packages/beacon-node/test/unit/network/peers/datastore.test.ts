import {expect} from "chai";
import {LevelDatastore} from "datastore-level";
import {Key} from "interface-datastore";
import sinon from "sinon";
import {Eth2PeerDataStore} from "../../../../src/network/peers/datastore.js";

describe("Eth2PeerDataStore", () => {
  let eth2Datastore: Eth2PeerDataStore;
  let dbDatastoreStub: sinon.SinonStubbedInstance<LevelDatastore> & LevelDatastore;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.useFakeTimers();
    dbDatastoreStub = sandbox.createStubInstance(LevelDatastore);
    eth2Datastore = new Eth2PeerDataStore(dbDatastoreStub, {threshold: 2, maxMemoryItems: 3});
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should persist to db after threshold put", async () => {
    await eth2Datastore.put(new Key("k1"), Buffer.from("1"));
    expect(dbDatastoreStub.batch).not.to.be.calledOnce;
    await eth2Datastore.put(new Key("k2"), Buffer.from("2"));
    expect(dbDatastoreStub.batch).to.be.calledOnce;
  });

  it("should persist to db the oldest item after max", async () => {
    // oldest item
    await eth2Datastore.put(new Key("k1"), Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    sandbox.clock.tick(1000);

    // 2nd, not call dbDatastoreStub.put yet
    await eth2Datastore.put(new Key("k2"), Buffer.from("2"));
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.put).not.to.be.calledOnce;
    // 3rd item, not call dbDatastoreStub.put yet
    await eth2Datastore.put(new Key("k3"), Buffer.from("3"));
    expect(await eth2Datastore.get(new Key("k3"))).to.be.deep.equal(Buffer.from("3"));
    expect(dbDatastoreStub.put).not.to.be.calledOnce;

    // 4th item, should evict 1st item since it's oldest
    await eth2Datastore.put(new Key("k4"), Buffer.from("4"));
    expect(await eth2Datastore.get(new Key("k4"))).to.be.deep.equal(Buffer.from("4"));
    expect(dbDatastoreStub.put).to.be.calledOnceWith(new Key("/k1"), Buffer.from("1"));

    // still able to get k1 from datastore
    expect(dbDatastoreStub.get).not.to.be.calledOnce;
    dbDatastoreStub.get.resolves(Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get).to.be.calledOnce;

    // access k1 again, should not query db
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get).to.be.calledOnce;
    expect(dbDatastoreStub.get).not.to.be.calledTwice;
  });

  it("should put to memory cache if item was found from db", async () => {
    dbDatastoreStub.get.resolves(Buffer.from("1"));
    // query db for the first time
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get).to.be.calledOnce;

    // this time it should not query from db
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get).to.be.calledOnce;
    expect(dbDatastoreStub.get).not.to.be.calledTwice;
  });
});
