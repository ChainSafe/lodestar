import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import {BeaconChain} from "../../../../../../src/chain";
import {Eth2Gossipsub} from "../../../../../../src/network/gossip";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {BeaconSync} from "../../../../../../src/sync";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;
  let block: SignedBeaconBlock;
  let blockApi: BeaconBlockApi;
  let chainStub: SinonStubbedInstance<BeaconChain>;
  let syncStub: SinonStubbedInstance<BeaconSync>;
  let server: ApiImplTestModules;

  before(function () {
    block = generateEmptySignedBlock();
  });

  beforeEach(function () {
    server = setupApiImplTestServer();
    gossipStub = sinon.createStubInstance(Eth2Gossipsub);
    gossipStub.publishBeaconBlock = sinon.stub();
    server.networkStub.gossip = (gossipStub as unknown) as Eth2Gossipsub;
    chainStub = server.chainStub;
    syncStub = server.syncStub;
    blockApi = new BeaconBlockApi(
      {},
      {
        chain: chainStub,
        config: server.config,
        db: server.dbStub,
        network: server.networkStub,
        sync: syncStub,
      }
    );
  });

  it("successful publish", async function () {
    syncStub.isSynced.returns(true);
    await expect(blockApi.publishBlock(block)).to.be.fulfilled;
    expect(chainStub.receiveBlock.calledOnceWith(block)).to.be.true;
    expect(gossipStub.publishBeaconBlock.calledOnceWith(block)).to.be.true;
  });

  it("node is syncing", async function () {
    syncStub.isSynced.returns(false);
    syncStub.getSyncStatus.returns({
      syncDistance: BigInt(50),
      headSlot: BigInt(0),
    });
    await expect(blockApi.publishBlock(block)).to.be.rejected;
    expect(chainStub.receiveBlock.called).to.be.false;
    expect(gossipStub.publishBeaconBlock.called).to.be.false;
  });
});
