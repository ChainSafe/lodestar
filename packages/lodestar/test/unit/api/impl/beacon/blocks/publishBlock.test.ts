import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {Gossip} from "../../../../../../src/network/gossip/gossip";
import {IGossip} from "../../../../../../src/network/gossip/interface";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {BeaconChain} from "../../../../../../src/chain";
import {BeaconSync} from "../../../../../../src/sync";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  let gossipStub: SinonStubbedInstance<IGossip>;
  let block: SignedBeaconBlock;
  let blockApi: BeaconBlockApi;
  let chainStub: SinonStubbedInstance<BeaconChain>;
  let syncStub: SinonStubbedInstance<BeaconSync>;

  beforeEach(() => {
    gossipStub = sinon.createStubInstance(Gossip);
    gossipStub.publishBlock = sinon.stub();
    this.ctx.networkStub.gossip = gossipStub;
    chainStub = this.ctx.chainStub;
    syncStub = this.ctx.syncStub;
    blockApi = new BeaconBlockApi(
      {},
      {
        chain: chainStub,
        config: this.ctx.config,
        db: this.ctx.dbStub,
        network: this.ctx.networkStub,
        sync: syncStub,
      }
    );
    block = generateEmptySignedBlock();
  });

  it("successful publish", async function () {
    syncStub.isSynced.returns(true);
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
    await expect(blockApi.publishBlock(block)).to.be.rejected;
    expect(chainStub.receiveBlock.called).to.be.false;
    expect(gossipStub.publishBlock.called).to.be.false;
  });
});
