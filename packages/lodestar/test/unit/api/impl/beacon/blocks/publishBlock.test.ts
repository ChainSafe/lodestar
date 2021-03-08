import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {Gossip} from "../../../../../../src/network/gossip/gossip";
import {IGossip} from "../../../../../../src/network/gossip/interface";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import {generateEmptySignedBlock} from "../../../../../utils/block";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  let gossipStub: SinonStubbedInstance<IGossip>;

  beforeEach(() => {
    gossipStub = sinon.createStubInstance(Gossip);
    gossipStub.publishBlock = sinon.stub();
    this.ctx.networkStub.gossip = gossipStub;
    this.ctx.blockApi = new BeaconBlockApi(
      {},
      {
        chain: this.ctx.chainStub,
        config: this.ctx.config,
        db: this.ctx.dbStub,
        network: this.ctx.networkStub,
        sync: this.ctx.syncStub,
      }
    );
  });

  it("successful publish", async function () {
    this.test?.ctx?.syncStub.isSynced.returns(true);
    const block = generateEmptySignedBlock();
    await expect(this.test?.ctx?.blockApi.publishBlock(block)).to.be.fulfilled;
    expect(this.test?.ctx?.chainStub.receiveBlock.calledOnceWith(block)).to.be.true;
    expect(gossipStub.publishBlock.calledOnceWith(block)).to.be.true;
  });

  it("node is syncing", async function () {
    this.test?.ctx?.syncStub.isSynced.returns(false);
    this.test?.ctx?.syncStub.getSyncStatus.returns({
      syncDistance: BigInt(50),
      headSlot: BigInt(0),
    });
    const block = generateEmptySignedBlock();
    await expect(this.test?.ctx?.blockApi.publishBlock(block)).to.be.rejected;
    expect(this.test?.ctx?.chainStub.receiveBlock.called).to.be.false;
    expect(gossipStub.publishBlock.called).to.be.false;
  });
});
