import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStubbedInstance } from "sinon";
import { Gossip } from "../../../../../../src/network/gossip/gossip";
import { IGossip } from "../../../../../../src/network/gossip/interface";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {syncStub, blockApi, chainStub, networkStub} from "./index.test";

use(chaiAsPromised);

describe("api - beacon - publishBlock", function () {
  let gossipStub: SinonStubbedInstance<IGossip>;

  beforeEach(() => {
    gossipStub = sinon.createStubInstance(Gossip);
    gossipStub.publishBlock = sinon.stub();
    networkStub.gossip = gossipStub;
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
