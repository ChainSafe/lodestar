import {config} from "@chainsafe/lodestar-config/minimal";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {IBeaconSync} from "../../../../../../src/sync/interface";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import {BeaconChain, IBeaconChain} from "../../../../../../src/chain";
import {Gossip} from "../../../../../../src/network/gossip/gossip";
import {INetwork} from "../../../../../../src/network/interface";
import {Network} from "../../../../../../src/network/network";
import {BeaconSync} from "../../../../../../src/sync/sync";
import {IGossip} from "../../../../../../src/network/gossip/interface";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {StubbedBeaconDb} from "../../../../../utils/stub";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  const sandbox = sinon.createSandbox();

  let blockApi: BeaconBlockApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;
  let dbStub: StubbedBeaconDb;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    syncStub = sinon.createStubInstance(BeaconSync);
    networkStub = sinon.createStubInstance(Network);
    gossipStub = sinon.createStubInstance(Gossip);
    gossipStub.publishBlock = sinon.stub();
    networkStub.gossip = gossipStub;
    dbStub = new StubbedBeaconDb(sinon, config);
    blockApi = new BeaconBlockApi(
      {},
      {
        chain: chainStub,
        config,
        sync: syncStub,
        network: networkStub,
        db: dbStub,
      }
    );
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("successful publish", async function () {
    syncStub.isSynced.returns(true);
    const block = generateEmptySignedBlock();
    await expect(blockApi.publishBlock(block)).to.be.fulfilled;
    expect(chainStub.receiveBlock.calledOnceWith(block)).to.be.true;
    expect(gossipStub.publishBlock.calledOnceWith(block)).to.be.true;
  });

  it("node is syncing", async function () {
    syncStub.isSynced.returns(false);
    syncStub.getSyncStatus.returns({
      syncDistance: BigInt(50),
      headSlot: BigInt(0),
    });
    const block = generateEmptySignedBlock();
    await expect(blockApi.publishBlock(block)).to.be.rejected;
    expect(chainStub.receiveBlock.called).to.be.false;
    expect(gossipStub.publishBlock.called).to.be.false;
  });
});
