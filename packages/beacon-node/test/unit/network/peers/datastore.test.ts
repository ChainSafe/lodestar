import {expect} from "chai";
import LevelDatastore from "datastore-level";
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
    expect(dbDatastoreStub.batch.calledOnce).to.be.false;
    await eth2Datastore.put(new Key("k2"), Buffer.from("2"));
    expect(dbDatastoreStub.batch.calledOnce).to.be.true;
  });

  it("should persist to db the oldest item after max", async () => {
    // oldest item
    await eth2Datastore.put(new Key("k1"), Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    sandbox.clock.tick(1000);

    // 2nd, not call dbDatastoreStub.put yet
    await eth2Datastore.put(new Key("k2"), Buffer.from("2"));
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.put.calledOnce).to.be.false;
    // 3rd item, not call dbDatastoreStub.put yet
    await eth2Datastore.put(new Key("k3"), Buffer.from("3"));
    expect(await eth2Datastore.get(new Key("k3"))).to.be.deep.equal(Buffer.from("3"));
    expect(dbDatastoreStub.put.calledOnce).to.be.false;

    // 4th item, should evict 1st item since it's oldest
    await eth2Datastore.put(new Key("k4"), Buffer.from("4"));
    expect(await eth2Datastore.get(new Key("k4"))).to.be.deep.equal(Buffer.from("4"));
    expect(dbDatastoreStub.put.calledOnceWith(new Key("k1"), Buffer.from("1"))).to.be.true;

    // still able to get k1 from datastore
    expect(dbDatastoreStub.get.calledOnce).to.be.false;
    dbDatastoreStub.get.resolves(Buffer.from("1"));
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get.calledOnce).to.be.true;

    // access k1 again, should not query db
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get.calledOnce).to.be.true;
    expect(dbDatastoreStub.get.calledTwice).to.be.false;
  });

  it("should put to memory cache if item was found from db", async () => {
    dbDatastoreStub.get.resolves(Buffer.from("1"));
    // query db for the first time
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get.calledOnce).to.be.true;

    // this time it should not query from db
    expect(await eth2Datastore.get(new Key("k1"))).to.be.deep.equal(Buffer.from("1"));
    expect(dbDatastoreStub.get.calledOnce).to.be.true;
    expect(dbDatastoreStub.get.calledTwice).to.be.false;
  });
});
